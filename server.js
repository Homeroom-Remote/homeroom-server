const express = require("express");
const app = express();
const server = require("http").Server(app);
const cors = require("cors");
const io = require("socket.io")(server, {
  cors: {
    methods: ["GET", "POST"],
  },
});

io.listen(3033);
const { ExpressPeerServer } = require("peer");
const peerServer = ExpressPeerServer(server, {
  debug: true,
});

const { isMeetingOnline } = require("./api");

const MAX_MESSAGE_LENGTH = 200;

app.use(cors());
app.use("/peerjs", peerServer);

app.set("view engine", "ejs");
app.use(express.static("public"));

app.get("/", (req, res) => {
  res.send("Homeroom server");
});

// class Participant {
//   socketId;
//   uid;

//   constructor(sid, uid) {
//     this.socketId = sid;
//     this.uid = uid;
//   }

//   getSocketId() {
//     return this.socketId;
//   }
//   getId() {
//     return this.uid;
//   }
// }

// class Rooms {
//   rooms = [];
//   constructor() {}

//   getRoom(id) {
//     return this.rooms.find((room) => room.id === id);
//   }
//   isRoomExists(id) {
//     return !!this.getRoom(id);
//   }
//   addRoom(id) {
//     return isRoomExists(id) ? this.getRoom(id) : new Room();
//   }
// }

// class Room {
//   id;
//   participants = [];
//   admin;
//   constructor() {}

//   addParticipant(socketId, userId) {
//     const participant = new Participant(socketId, userId);
//     this.participants.push(participant);
//     return participant;
//   }
//   removeParticipantByUserId(uid) {
//     this.participants = this.participants.filter(
//       (participant) => participant.uid !== uid
//     );
//   }

//   removeParticipantBySocketId(sid) {
//     this.participants = this.participants.filter(
//       (participant) => participant.socketId !== sid
//     );
//   }

//   isParticipant(uid) {
//     return !!this.participants.find((participant) => participant.uid === uid);
//   }

//   getAdmin() {
//     return this.admin;
//   }
// }

// const rooms = new Rooms();

io.on("connection", (socket) => {
  console.log("subscriber connected:", socket.id);

  socket.on("disconnect", () => {
    console.log("subscriber disconnected:", socket.id);
  });
  socket.on("join-room", (roomId, userId) => {
    socket.on("ready", () => {
      console.log(socket.id, "declared ready");

      isMeetingOnline(roomId)
        .then((meetingDocument) => {
          socket.join(roomId);
          console.log(userId, "joined room", roomId);
          socket.broadcast.to(roomId).emit("user-connected", userId);

          socket.on("disconnect", () => {
            console.log(userId, "disconnected from", roomId);
            socket.broadcast.to(roomId).emit("user-disconnected", userId);
          });
          socket.on("new-stream", () => {
            console.log(userId, "new stream");
            socket.broadcast.to(roomId).emit("new-stream", userId);
          });

          socket.on("message", (message) => {
            if (!message || message.length > MAX_MESSAGE_LENGTH) return;
            console.log(`[${roomId}] (${userId}): ${message}`);
            socket.broadcast.to(roomId).emit("message", {
              sender: userId,
              socketId: socket.id,
              message: message,
              time: new Date().toISOString(),
            });
          });
        })
        .catch((error) => {
          console.warn(
            userId,
            "tryed to join",
            roomId,
            "and encountered ",
            error
          );
          socket.emit("connection-error", error);
        });
    });
  });
});

server.listen(process.env.PORT || 3030);
