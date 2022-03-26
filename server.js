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

app.use(cors());
app.use("/peerjs", peerServer);

app.set("view engine", "ejs");
app.use(express.static("public"));

app.get("/", (req, res) => {
  res.send("Homeroom server");
});

io.on("connection", (socket) => {
  console.log("subscriber connected:", socket.id);

  socket.on("disconnect", () => {
    console.log("subscriber disconnected:", socket.id);
  });
  socket.on("join-room", (roomId, userId) => {
    socket.on("new-stream", () => {
      console.log(userId, "new stream");
      socket.broadcast.to(roomId).emit("new-stream", userId);
    });
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
