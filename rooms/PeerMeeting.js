const { Room, ServerError } = require("colyseus");
const {
  validateToken,
  isMeetingExists,
  addParticipantToMeeting,
  removeParticipantFromMeeting,
  closeMeetingOnServer,
  openMeetingOnServer,
  addMeetingToHistory,
  createLogsOnServer,
} = require("../api");

const {
  disposeQuestionIfExists,
  isQuestionInQueue,
} = require("../questionQueueUtils");

class PeerMeetingRoom extends Room {
  // When room is initialized
  participants = new Map();
  questionQueue = new Array();
  concentrationScore = new Map();
  expressions = new Map();
  machineLearningLogs = new Array();
  statisticsInterval = null;
  started = null;
  async onCreate(options) {
    // Validate User
    const userData = await validateToken(options.accessToken);
    if (!userData) throw new ServerError(400, "bad access token");

    // Validate meeting ID exists
    const meetingId = options.meetingId;
    if (!meetingId || meetingId.length != 6)
      throw new ServerError(400, "Invalid meeting ID");

    // Validate meeting exists
    const meeting = isMeetingExists(meetingId);
    if (!meeting) throw new ServerError(400, "no meeting in DB");

    // Validate user is trying to open his own meeting room
    const uid = userData.uid;
    if (uid.slice(0, 6) !== meetingId)
      throw new ServerError(
        401,
        "not authorized to open a different meeting ID"
      );

    // Success

    this.roomId = meetingId;
    this.started = new Date();
    console.log("opened meeting", this.roomId);
    this.statisticsInterval = setInterval(
      () => this.handleCheckpoint(this),
      5000
    );

    // Register message callbacks

    this.onMessage("get-owner", (client, message) => {
      client.send("get-owner", { owner: this.owner });
    });
    this.onMessage("chat-message", (client, message) => {
      const senderObject = this.participants.get(client.sessionId);

      const messageObject = {
        sender: senderObject.sessionId,
        uid: senderObject.uid,
        name: senderObject.name,
        time: new Date().toISOString(),
        message: message,
      };

      // Broadcast message to everyone exepct the sender
      this.broadcast("chat-message", messageObject, { except: client });
      client.send("chat-message", { ...messageObject, me: true });
    });

    this.onMessage("concentration", (client, score) => {
      if (this.concentrationScore.has(client.sessionId))
        this.concentrationScore.set(client.sessionId, {
          score: this.concentrationScore.get(client.sessionId).score + score,
          samples: this.concentrationScore.get(client.sessionId).samples + 1,
        });
      else
        this.concentrationScore.set(client.sessionId, {
          score: score,
          samples: 1,
        });
    });

    this.onMessage("expressions", (client, expressions) => {
      if (this.expressions.has(client.sessionId))
        this.expressions.set(client.sessionId, {
          expressions: [
            ...this.expressions.get(client.sessionId).expressions,
            expressions,
          ],
          samples: this.expressions.get(client.sessionId).samples + 1,
        });
      else
        this.expressions.set(client.sessionId, {
          expressions: [expressions],
          samples: 1,
        });
      const senderObject = this.participants.get(client.sessionId);
    });
    this.onMessage("hand-gesture", (client, message) => {
      const senderObject = this.participants.get(client.sessionId);

      const messageObject = {
        sender: senderObject.sessionId,
        uid: senderObject.uid,
        name: senderObject.name,
        time: new Date().toISOString(),
        message: message,
      };

      // Broadcast message to everyone exepct the sender
      this.broadcast("hand-gesture", messageObject, { except: client });
    });

    this.onMessage("signal", (client, data) => {
      const senderObject = this.participants.get(client.sessionId);
      if (!this.participants.has(data.sessionId)) {
        console.log("invalid signal sessionId", data.sessionId);
        return;
      }

      this.participants.get(data.sessionId).client.send("signal", {
        sessionId: client.sessionId,
        data: data.data,
        uid: senderObject.uid,
        name: senderObject.name,
      });
    });

    //////////////////////////
    // Question queue messages
    //////////////////////////
    this.onMessage("get-question-queue", (client, data) => {
      client.send("get-question-queue", { queue: this.questionQueue });
    });

    this.onMessage("add-to-question-queue", (client, data) => {
      if (
        !isQuestionInQueue(client.sessionId, this.questionQueue) &&
        this.participants.has(client.sessionId)
      ) {
        const userObject = this.participants.get(client.sessionId);
        const questionObject = {
          id: client.sessionId,
          uid: userObject.uid,
          displayName: userObject.name,
        };
        this.questionQueue.push(questionObject);
        this.broadcast("question-queue-update", {
          event: "add",
          data: questionObject,
        });
        client.send("question-queue-status", {
          event: "add",
          status: true,
        });
      } else {
        client.send("question-queue-status", {
          event: "add",
          status: false,
          message: "Already in queue.",
        });
      }
    });

    this.onMessage("remove-from-question-queue", (client, data) => {
      const authorized =
        (data.id &&
          this.participants.get(client.sessionId)?.uid === this.owner) ||
        client.sessionId === data.id ||
        !data.id;

      if (
        !isQuestionInQueue(data.id, this.questionQueue) &&
        !isQuestionInQueue(client.sessionId, this.questionQueue)
      ) {
        client.send("question-queue-status", {
          event: "remove",
          status: false,
          message: "ID wasn't in queue",
        });
      } else if (!authorized) {
        client.send("question-queue-status", {
          event: "remove",
          status: false,
          message: "Not authorized",
        });
      } else {
        const id = data.id || client.sessionId;
        console.log(
          `user ${client.sessionId} removing ${id} from question queue`
        );
        this.questionQueue = this.questionQueue.filter((qo) => qo.id !== id);
        console.log(this.questionQueue);
        this.broadcast("question-queue-update", {
          event: "remove",
          data: {
            id: id,
          },
        });
      }
    });
    // Open meeting on server

    this.owner = uid;
    const meetingData = await openMeetingOnServer(meetingId);

    return meetingData;
  }

  // Authorize client (before onJoin)
  async onAuth(client, options, request) {
    const selectedName = options.name;
    const userData = await validateToken(options.accessToken);
    if (userData) {
      addMeetingToHistory(this.roomId, userData);
      return { ...userData, name: selectedName };
    } else throw new ServerError(400, "bad access token");
  }

  // When client successfully joins the room
  async onJoin(client, options, auth) {
    const newParticipant = {
      sessionId: client.sessionId,
      uid: auth.uid,
      name: auth.name,
      client: client,
    };

    this.broadcast("join", newParticipant, { except: client });

    this.participants.set(client.sessionId, newParticipant);

    client.send("get-question-queue", { queue: this.questionQueue });
    client.send("get-owner", { owner: this.owner });

    addParticipantToMeeting(this.roomId, auth.uid)
      .then((snapshot) => {
        return snapshot;
      })
      .catch((e) => {
        throw new ServerError("400", e);
      });

    return true;
  }

  // When client leaves the room
  onLeave(client, consented) {
    console.log(client.sessionId, "left");
    this.broadcast("leave", { sessionId: client.sessionId });
    if (this.participants.has(client.sessionId)) {
      const uid = this.participants.get(client.sessionId).uid;
      removeParticipantFromMeeting(this.roomId, uid);
      this.participants.delete(client.sessionId);
    }

    if (isQuestionInQueue(client.sessionId, this.questionQueue)) {
      this.questionQueue = this.questionQueue.filter(
        (qo) => qo.id !== client.sessionId
      );
      this.broadcast("question-queue-update", {
        event: "remove",
        data: {
          id: client.sessionId,
        },
      });
    }
  }

  // Cleanup, called after no more clients
  async onDispose() {
    console.log("No more clients, closing room", this.roomId);
    if (this.statisticsInterval) clearInterval(this.statisticsInterval);
    if (this.roomId) {
      if (this.machineLearningLogs.length > 0) {
        console.log(this.machineLearningLogs);
        await createLogsOnServer(this.roomId, this.machineLearningLogs);
      }

      await closeMeetingOnServer(this.roomId);
    }
  }

  handleCheckpoint() {
    var concentration = null;
    var expressions = null;

    if (this.concentrationScore.size > 0) {
      const nParticipants = this.concentrationScore.size;
      var mSamplesPerParticipant = 0;
      var avgScore = 0;

      for (let [key, value] of this.concentrationScore) {
        mSamplesPerParticipant += value.samples;
        avgScore += value.score;
      }

      mSamplesPerParticipant /= nParticipants;
      avgScore /= mSamplesPerParticipant * nParticipants;

      concentration = {
        participants: nParticipants,
        mSamples: mSamplesPerParticipant,
        score: avgScore,
      };

      this.concentrationScore.clear();
    }

    if (this.expressions.size > 0) {
      const nParticipants = this.expressions.size;
      var mSamplesPerParticipant = 0;
      var expressionArray = [];

      for (let [key, value] of this.expressions) {
        mSamplesPerParticipant += value.samples; // sum samples
        expressionArray.push(...value.expressions); // create an expression array
      }

      mSamplesPerParticipant /= nParticipants;

      const avgExpression = expressionArray[0]; // first expression is base object
      expressionArray
        .splice(1)
        .forEach((obj) =>
          Object.entries(obj).forEach(([k, v]) => (avgExpression[k] += v))
        ); // traverse every expression object and sum it's values ot avgExpression

      Object.keys(avgExpression).forEach(
        (key) => (avgExpression[key] /= mSamplesPerParticipant * nParticipants)
      ); // divide each reduced expression by sum of all samples

      expressions = {
        participants: nParticipants,
        mSamples: mSamplesPerParticipant,
        expressions: avgExpression,
      };
      this.expressions.clear();
    }

    if (concentration || expressions) {
      const log = {
        concentration: concentration,
        expressions: expressions,
        at: new Date(),
      };
      this.machineLearningLogs.push(log);
      this.broadcast("face-recognition", log);
    }
  }
}

module.exports = PeerMeetingRoom;
