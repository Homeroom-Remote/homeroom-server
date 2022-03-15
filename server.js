const express = require("express");
const app = express();
const server = require("http").Server(app);
const cors = require("cors");
const io = require("socket.io")(server, {
  cors: {
    methods: ["GET", "POST"],
  },
});

const { ExpressPeerServer } = require("peer");
const peerServer = ExpressPeerServer(server, {
  debug: true,
});

const { isMeetingOnline } = require("./api");
const { Socket } = require("socket.io");

app.use(cors());
app.use("/peerjs", peerServer);

app.set("view engine", "ejs");
app.use(express.static("public"));

app.get("/", (req, res) => {
  res.send("Homeroom server");
});

io.on("connection", (socket) => {
  console.log("New socket connection");
  socket.on("join-room", (roomId, userId) => {
    isMeetingOnline(roomId)
      .then((meetingDocument) => {
        socket.join(roomId);
        console.log(userId, "joined room", roomId);
        socket.to(roomId).emit("user-connected", userId);

        socket.on("disconnect", () => {
          console.log(userId, "disconnected from", roomId);
          socket.to(roomId).emit("user-disconnected", userId);
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

server.listen(process.env.PORT || 3030);
