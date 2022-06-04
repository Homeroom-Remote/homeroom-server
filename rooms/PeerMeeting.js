const { Room, ServerError } = require("colyseus");
const config = require("config");
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
  concentrationScore = new Map();
  expressions = new Map();
  questionQueue = new Array();
  machineLearningLogs = new Array();
  engagementLogs = new Array();
  statisticsInterval = null;
  started = null;
  peakParticipants = 0;
  screenShare = null;
  ////////////////////////////////////////
  chatArray = new Array();
  ////////////////////////////////////////
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
    ////////////////////////////////////////
    this.onMessage("get-chat", (client, message) => {
      client.send("get-chat", this.chatArray);
    });
    ////////////////////////////////////////

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
        messageSentAt: new Date(),
      };

      ////////////////////////////////////////
      this.chatArray.push(messageObject);
      ////////////////////////////////////////

      // Broadcast message to everyone exepct the sender
      this.engagementLogs.push({ event: "message", at: new Date() });
      this.broadcast("chat-message", messageObject, { except: client });
      client.send("chat-message", { ...messageObject, me: true });
    });

    this.onMessage("survey-form", (client, message) => {
      const senderObject = this.participants.get(client.sessionId);

      const messageObject = {
        sender: senderObject.sessionId,
        uid: senderObject.uid,
        name: senderObject.name,
        time: new Date().toISOString(),
        message: message?.question,
        surveyTime: message?.surveyTime,
        messageSentAt: new Date(),
      };
      console.log(message)
      // console.log(time)

      this.broadcast("survey-question", messageObject, { except: client });
    });

    this.onMessage("survey-answer", (client, message) => {
      const senderObject = this.participants.get(client.sessionId);

      const messageObject = {
        sender: senderObject.sessionId,
        uid: senderObject.uid,
        name: senderObject.name,
        time: new Date().toISOString(),
        message: message,
      };

      let owner_client;
      for (let [key, value] of this.participants) {
        if (value.uid === this.owner) {
          owner_client = value.client;
          break;
        }
      }

      owner_client?.send("survey-answer-client", messageObject);
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

    ////////////////////////
    // Screen share messages
    ////////////////////////
    this.onMessage("share-screen", (client, data) => {
      if (data?.event === "start") {
        if (this.screenShare) {
          client.send("share-screen", {
            event: "denied-start",
            data: "Screen share already in progress.",
          }); // deny request
          client.send("share-screen", {
            event: "start",
            user: this.screenShare,
          }); // send actual screen share to mitigate bugs
        } else {
          this.screenShare = this.participants.get(client.sessionId).uid;
          this.broadcast("share-screen", {
            event: "start",
            user: this.screenShare,
          });
        }
      } else if (data?.event === "stop" && this.screenShare) {
        if (
          this.screenShare === client.sessionId ||
          this.owner === this.participants.get(client.sessionId).uid
        ) {
          this.broadcast("share-screen", {
            event: "stop",
            from: this.screenShare,
          });
          this.screenShare = null;
        } else {
          client.send("share-screen", {
            event: "denied-stop",
            data: "Not authorized for that action.",
          });
        }
      }
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
        this.engagementLogs.push({ event: "question", at: new Date() });
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
    this.peakParticipants += 1;
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
    this.peakParticipants -= 1;
    console.log(client.sessionId, "left");
    this.broadcast("leave", { sessionId: client.sessionId });
    if (this.participants.has(client.sessionId)) {
      const uid = this.participants.get(client.sessionId).uid;
      removeParticipantFromMeeting(this.roomId, uid);
      this.participants.delete(client.sessionId);
    }

    if (this.screenShare === client.sessionId) {
      this.broadcast("share-screen", {
        event: "stop",
        from: this.screenShare,
      });
      this.screenShare = null;
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
      const meetingDurationInSeconds =
        (new Date().getTime() - this.started.getTime()) / 1000;
      if (
        this.machineLearningLogs.length > 0 &&
        meetingDurationInSeconds >=
        (config.app.meeting_log_threshold_in_seconds || 1000)
      ) {
        const scoreObject = await this.calculateScore(
          this.machineLearningLogs,
          this.engagementLogs,
          meetingDurationInSeconds
        );
        await createLogsOnServer(
          this.roomId,
          this.machineLearningLogs,
          this.engagementLogs,
          this.started,
          this.peakParticipants,
          meetingDurationInSeconds,
          scoreObject
        );
      }

      await closeMeetingOnServer(this.roomId);
    }
  }

  async calculateScore(machineLearningLogs, engagementLogs, durationInSeconds) {
    function getRandomTip(arrayOfTips) {
      return arrayOfTips[Math.floor(Math.random() * arrayOfTips.length)];
    }

    const scoring_system = config.app.scoring_system;
    const durationInMinutes = durationInSeconds / 60;
    const goodTipThreshold = scoring_system.good_tip_threshold;

    if (durationInMinutes < config.app.meeting_score_threshold_in_minutes)
      return null;

    var tips = [];
    var score = 0;

    /////////////
    // Engagement
    /////////////
    const questionPercentage = scoring_system.questions;
    const chatPercentage = scoring_system.chat;

    const questionRequirements = scoring_system.question_requirements;
    const chatRequirements = scoring_system.chat_requirements;

    const averageQuestionsPerMinute =
      engagementLogs.filter((log) => log.event === "question").length /
      durationInMinutes;

    const averageChatMessagesPerMinute =
      engagementLogs.filter((log) => log.event === "chat").length /
      durationInMinutes;

    const questionsMark =
      (averageQuestionsPerMinute /
        (questionRequirements[0] / questionRequirements[1])) *
      100;
    const chatMark =
      (averageChatMessagesPerMinute /
        (chatRequirements[0] / chatRequirements[1])) *
      100;

    score += Math.min(100, questionsMark) * questionPercentage;
    score += Math.min(100, chatMark) * chatPercentage;

    tips.push(
      getRandomTip(
        questionsMark >= goodTipThreshold
          ? scoring_system.tips.questions_good
          : scoring_system.tips.questions_bad
      )
    );

    ////////////////
    // Concentration
    ////////////////
    const concentrationPercentage = scoring_system.concentration;
    const concentrationRequirements = scoring_system.concentration_requirements;
    const concentrationMark =
      machineLearningLogs.reduce(
        (prev, current) => prev + (current?.concentration?.score || prev),
        0
      ) / machineLearningLogs.length;

    score += Math.min(100, concentrationMark * 100) * concentrationPercentage;

    tips.push(
      getRandomTip(
        concentrationMark >= concentrationRequirements
          ? scoring_system.tips.concentration_good
          : scoring_system.tips.concentration_bad
      )
    );
    //////////////
    // Expressions
    //////////////
    const expressionsPercentage = scoring_system.expressions;
    const expressionsRequirements = scoring_system.expressions_requirements;
    const expressionsScores = scoring_system.expressions_scoring;
    const scoreSwitch = {
      neutral: expressionsScores.neutral,
      happy: expressionsScores.happy,
      sad: expressionsScores.sad,
      disgusted: expressionsScores.disgusted,
      fearful: expressionsScores.fearful,
    };

    var expressionsAcc = 0;
    var surprised = 0;
    var relevantLogs = 0;

    machineLearningLogs.forEach((log) => {
      const expressions = log?.expressions?.expressions;
      if (expressions) {
        relevantLogs += 1;
        surprised += expressions.surprised;
        expressionsAcc += expressions.neutral * scoreSwitch["neutral"];
        expressionsAcc += expressions.happy * scoreSwitch["happy"];
        expressionsAcc += expressions.sad * scoreSwitch["sad"];
        expressionsAcc += expressions.disgusted * scoreSwitch["disgusted"];
        expressionsAcc += expressions.fearful * scoreSwitch["fearful"];
      }
    });

    expressionsAcc +=
      surprised *
      (expressionsAcc < 0
        ? expressionsScores.surprised_if_positive
        : expressionsScores.surprised_if_negative);

    expressionsAcc = expressionsAcc.toFixed(2) / relevantLogs;
    score += Math.max(
      0,
      Math.min((expressionsAcc + 1) * 100, 100) * expressionsPercentage
    );

    tips.push(
      getRandomTip(
        expressionsAcc >= expressionsRequirements
          ? scoring_system.tips.expressions_good
          : scoring_system.tips.expressions_bad
      )
    );

    score = score.toFixed(2);

    return { score, tips };
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
