const { Room, ServerError } = require("colyseus");
const {
  validateToken,
  isMeetingExists,
  addParticipantToMeeting,
  removeParticipantFromMeeting,
  closeMeetingOnServer,
  openMeetingOnServer,
  addMeetingToHistory,
} = require("../api");

const {
  disposeQuestionIfExists,
  isQuestionInQueue,
} = require("../questionQueueUtils");

class PeerMeetingRoom extends Room {
  // When room is initialized
  participants = new Map();
  questionQueue = new Array();
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
    console.log("opened meeting", this.roomId);

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
      console.log(data, client.sessionId, this.questionQueue);
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
    this.roomId &&
      closeMeetingOnServer(this.roomId)
        .then(() => {})
        .catch(() => {});
  }
}

module.exports = PeerMeetingRoom;
