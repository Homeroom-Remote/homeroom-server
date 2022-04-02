const { Room, ServerError } = require("colyseus");
const {
  validateToken,
  isMeetingExists,
  addParticipantToMeeting,
  removeParticipantFromMeeting,
  closeMeetingOnServer,
  openMeetingOnServer,
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
    this.roomId = meetingId;
    this.owner = uid;
    const meetingData = await openMeetingOnServer(meetingId);

    return meetingData;
  }

  // Authorize client (before onJoin)
  async onAuth(client, options, request) {
    const userData = await validateToken(options.accessToken);
    if (userData) return userData;
    else throw new ServerError(400, "bad access token");
  }

  // When client successfully joins the room
  async onJoin(client, options, auth) {
    const newParticipant = {
      sessionId: client.sessionId,
      uid: auth.uid,
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
    this.broadcast("leave", client.sessionId);
    if (this.participants.has(client.sessionId)) {
      const uid = this.participants.get(client.sessionId).uid;
      removeParticipantFromMeeting(this.roomId, uid);
      this.participants.delete(client.sessionId);
    }
  }

  // Cleanup, called after no more clients
  onDispose() {
    console.log("No more clients, closing room");
    this.roomId && closeMeetingOnServer(this.roomId);
  }
}

module.exports = PeerMeetingRoom;
