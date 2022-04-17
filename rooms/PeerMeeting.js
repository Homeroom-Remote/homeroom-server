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

class PeerMeetingRoom extends Room {
  // When room is initialized
  participants = new Map();
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

    // Register message callbacks
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
    // Open meeting on server
    this.roomId = meetingId;
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
    this.broadcast("leave", { sessionId: client.sessionId });
    if (this.participants.has(client.sessionId)) {
      const uid = this.participants.get(client.sessionId).uid;
      removeParticipantFromMeeting(this.roomId, uid);
      this.participants.delete(client.sessionId);
    }
  }

  // Cleanup, called after no more clients
  async onDispose() {
    console.log("No more clients, closing room");
    this.roomId &&
      closeMeetingOnServer(this.roomId)
        .then(() => {})
        .catch(() => {});
  }
}

module.exports = PeerMeetingRoom;
