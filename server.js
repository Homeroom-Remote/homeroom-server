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
const { v4: uuidV4 } = require("uuid");
app.use(cors());
app.use("/peerjs", peerServer);

app.set("view engine", "ejs");
app.use(express.static("public"));

app.get("/", (req, res) => {
  res.send("hey");
});

io.on("connection", (socket) => {
  console.log("someone connected");
  socket.on("join-room", (roomId, userId) => {
    console.log(roomId, userId);
    console.log("someone joined room", roomId, userId);
    socket.join(roomId);
    socket.to(roomId).broadcast?.emit("user-connected", userId);
    // socket.on("message", (message) => {
    //   //send message to the same room
    //   io.to(roomId).emit("createMessage", message);
    // });

    socket.on("disconnect", () => {
      socket.to(roomId).broadcast.emit("user-disconnected", userId);
    });
  });
});

server.listen(process.env.PORT || 3030);
