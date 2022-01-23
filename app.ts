import express from 'express';
import cors from 'cors';
import socketio from 'socket.io';
import http from 'http';
import Game from './source/game';
import path from 'path';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import {  gameModel  } from './model/db-model';
dotenv.config();

// create the game
let gameController: Game = new Game();

const app = express();
const PORT = 3000;
const server = http.createServer(app);
mongoose.connect(process.env.CONNECTION_STRING, { useNewUrlParser: true });
mongoose.connection.once("open", () => {
  console.log("connected to db "+process.env.CONNECTION_STRING)
})
app.use(cors());
app.use(express.static('output'));
app.use(express.static('styles'));
const io = socketio.listen(server);

app.get('/', (req,res) => {
  res.sendFile(path.join(__dirname,"index.html"))
})
io.on("connection", (socket) => {
  

  socket.on("createGame", async (data) => {
            const roomId=randomstring.generate({length: 4});
    try {
      if(!roomId.name || roomId.number === undefined || !roomId.playerId)throw new Error("not enough data");
      
      let newGame = new gameModel({
        players : [{
          name: roomId.name,
          index: roomId.number,
          playerId: roomId.playerId,
          socketId: socket.id,
          drawCard: 0,
          score:0
        }],
        currentPlayerTurn: 0,
        gameStart: false,
        isReversed:false
      });
      await newGame.save();
      // send back id to host
      socket.emit("createdGameId", {
        gameId: newGame._id,
        playerId:roomId.playerId
      });
      // set gameid property on the socket object
      socket.gameId = newGame._id;
    } catch (err) {
      socket.emit("errorInRequest",{msg:err.message});
    }
    
  })

  // when other user want to join game
  socket.on("joinGame", async (data) => {
    try {
      if (!roomId.gameId || !roomId.playerId) throw new Error("not enough data");
      let game = await gameModel.findById(roomId.gameId);
      if(!game) throw new Error("no game with this id");
      
      if (game.gameStart) {
        throw new Error("the game already runnning cannot join");
        
       
      }
      // check that didnt join before
      for (let player of game.players) {
        if (player.playerId == roomId.playerId) return;
      }
      let index = game.players.length;
      game.players.push({
        name: roomId.name,
        index: index,
        playerId: roomId.playerId,
        socketId: socket.id,
        drawCard: 0,
        score:0
      });
      // set gameid property on the socket object
      socket.gameId = game._id;
      let players = [];
      for (let player of game.players) {
        players.push({
          name: player.name,
          index: player.index
        });
      }
      game.markModified("players");
      await game.save();
      socket.emit("joinedGame", {
        gameId: game._id,
        playerId: roomId.playerId,
        index: index
      });
      for (let player of game.players) {
        io.to(player.socketId).emit("queueChanged", {
          gameId: game._id,
          players: players
        });
      }
      
    }catch(err){
      socket.emit("errorInRequest",{msg:err.message});
    }
  });


  // create game instance when the host start the game
  socket.on("startGame", async (data) => {
    try {
      let game = await gameModel.findById(roomId.gameId);
      if(!game) throw new Error("no game with this id");
      
    
    
    let players = [];
    for (let player of game.players) players.push(player);
      game = await gameController.createGame(game._id, players);
    players = [];
    for (let player of game.players) {
      players.push({
        name: player.name,
        index: player.index,
        number: player.cards.length,
        score:player.score
      })
      }
    for (let player of game.players) { 
      io.to(player.socketId).emit("gameCreated", {
        gameId: roomId.gameId,
        players: players,
        currentCard: game.currentCard,
        currentPlayerTurn: game.currentPlayerTurn,
        currenColor:game.currentColor
      });
    }
    
    for (let player of game.players) {
      io.to(player.socketId).emit("getCards", {
        playerId: player.playerId,
        cards: player.cards,
        gameId:roomId.gameId
      });
      }
      
      
    }catch(err){
      socket.emit("errorInRequest",{msg:err.message});
    }
  });

  // player play card
  socket.on("playCard", async (data) => {
    try{
    let isPlayed = await gameController.play(roomId.gameId, roomId.playerIndex, roomId.cardIndex, roomId.card,roomId.playerId);
    if (isPlayed == -1) {
      socket.emit("wrongTurn", {
        gameId: roomId.gameId,
        playerIndex: roomId.playerIndex,
        playerId:roomId.playerId
      });
      return;
    }else if (isPlayed == 0) {
      socket.emit("wrongMove", {
        gameId: roomId.gameId,
        playerIndex: roomId.playerIndex,
        playerId:roomId.playerId
      });
      return;
    } 
    let game = await gameModel.findById(roomId.gameId);
    let players = [];
    for (let player of game.players) {
      players.push({
        name: player.name,
        index: player.index,
        number:player.cards.length,
        score:player.score
      })
      }
      for (let player of game.players) { 
        io.to(player.socketId).emit("gameUpdated", {
          gameId: roomId.gameId,
          players: players,
          currentCard: game.currentCard,
          currentPlayerTurn: game.currentPlayerTurn,
          currenColor: game.currentColor,
          cardDrawn: isPlayed == 4 || isPlayed == 3 ? true : false,
        });
      }
   
    // update each on cards
      let uno = false;
      if (game.players[roomId.playerIndex].cards.length == 1) uno = true;
    for (let player of game.players) {
      io.to(player.socketId).emit("getCards", {
        playerId: player.playerId,
        cards: player.cards,
        gameId:roomId.gameId
      });
      
      }
      if (uno) {
        for (let player of game.players) { 
          io.to(player.socketId).emit("uno", {
          
            gameId: roomId.gameId
          });
        }
        
      }
     if (isPlayed == 2) {
      io.to(game.players[game.currentPlayerTurn].socketId).emit("drawTwo", {
        gameId: roomId.gameId
      });
    } else if (isPlayed == 3) {
       io.sockets.emit("chooseColor", {
         gameId: roomId.gameId,
         playerIndex: roomId.playerIndex,
         playerId: game.players[roomId.playerIndex].playerId
       });
     } else if (isPlayed == 4) {
      io.sockets.emit("chooseColor", {
        gameId: roomId.gameId,
        playerIndex: roomId.playerIndex,
        playerId: game.players[roomId.playerIndex].playerId
      });
      gameController.calculateNextTurn(game);
      io.to(game.players[game.currentPlayerTurn].socketId).emit("drawFour", {
        gameId: roomId.gameId
      });
      game.isReversed = !game.isReversed;
      gameController.calculateNextTurn(game);
       game.isReversed = !game.isReversed;
     } else if (isPlayed == 5) {
      io.sockets.emit("skipTurn", {
        gameId: roomId.gameId
      });
     } else if (isPlayed == 6) {
      io.sockets.emit("reverseTurn", {
        gameId: roomId.gameId
      });
     }else if (isPlayed == 7) {
      io.sockets.emit("gameEnd", { gameId:roomId.gameId,playerIndex:roomId.playerIndex,playerId:roomId.playerId,success: "game ended" });
    }
    } catch (err) {
    socket.emit("errorInRequest",{msg:err.message});
  }
  });

  socket.on("colorIsChosen", async (data) => {
    try {
      if(!roomId.gameId || !roomId.color || roomId.playerIndex === undefined  || !roomId.playerId)throw new Error("data is not enough");
      
    await gameController.changCurrentColor(roomId.gameId, roomId.color, roomId.playerIndex, roomId.playerId);
    let game = await gameModel.findById(roomId.gameId)
    let players = [];
    for (let player of game.players) {
      players.push({
        name: player.name,
        index: player.index,
        number: player.cards.length,
        score:player.score
      })
      }
      for (let player of game.players) { 
        io.to(player.socketId).emit("gameUpdated", {
          gameId: roomId.gameId,
          players: players,
          currentCard: game.currentCard,
          currentPlayerTurn: game.currentPlayerTurn,
          currenColor: game.currentColor,
          cardDrawn: true
        });
      }
    
  }catch(err){
    socket.emit("errorInRequest",{msg:err.message});
  }
    
    
  });

  socket.on("drawCard", async (data) => {
    try {
      
      if(!roomId.gameId ||  roomId.playerIndex === undefined || !roomId.playerId)throw new Error("data is not enough");
    let x = await gameController.drawCard(roomId.gameId, roomId.playerIndex,roomId.playerId);
    if (!x) {
      socket.emit("cannotDraw", {
        gameId: roomId.gameId,
        playerIndex: roomId.playerIndex,
        playerId: roomId.playerId,
      });
      return;
    } 
    let game = await gameModel.findById(roomId.gameId);
    let players = [];
    for (let player of game.players) {
      players.push({
        name: player.name,
        index: player.index,
        number: player.cards.length,
        score:player.score
      })
      }
      for (let player of game.players) { 
        io.to(player.socketId).emit("gameUpdated", {
          gameId: roomId.gameId,
          players: players,
          currentCard: game.currentCard,
          currentPlayerTurn: game.currentPlayerTurn,
          currenColor: game.currentColor,
          cardDrawn: true
        });
      }
    
    // update each on cards

      socket.emit("getCards", {
        playerId: roomId.playerId,
        cards: game.players[roomId.playerIndex].cards,
        gameId:roomId.gameId
      });
   
      
    } catch (err) {
      console.log(err);
    socket.emit("errorInRequest",{msg:err.message});
  }
  });

  socket.on("endTurn", async (data) => {
    try {
      let game = await gameModel.findById(roomId.gameId);
      if(!game) throw new Error("no game with this id");
      
      if (game.currentPlayerTurn == roomId.playerIndex && game.players[game.currentPlayerTurn].playerId == roomId.playerId && game.players[game.currentPlayerTurn].canEnd) {
        await gameController.calculateNextTurn(game);
        await game.save();
        let players = [];
        for (let player of game.players) {
          players.push({
            name: player.name,
            index: player.index,
            number: player.cards.length,
            score:player.score
          })
        }
        for (let player of game.players) { 
          io.to(player.socketId).emit("gameUpdated", {
            gameId: roomId.gameId,
            players: players,
            currentCard: game.currentCard,
            currentPlayerTurn: game.currentPlayerTurn,
            currenColor: game.currentColor
          });
        }
        
        // update each on cards
  
    for (let player of game.players) {
     
      io.to(player.socketId).emit("getCards", {
        playerId: player.playerId,
        cards: player.cards,
        gameId:roomId.gameId
      });
   
      }

   
      } else if (!game.players[game.currentPlayerTurn].canEnd) {
        socket.emit("errorInRequest", { msg: "cannot end turn draw card or play card" });
      }
    } catch (err) {
      socket.emit("errorInRequest", { msg: err });
    }
  });


  socket.on('disconnect', async () => {
    try{
    const socketId = socket.id;
    const gameId = socket.gameId;
    const game = await gameModel.findById(gameId);
    if (!game) return;
      let player: any;
      let disconnected = 0;
    // remove this player from the game
    for (let i = 0; i < game.players.length; i++){
      if (game.players[i].socketId == socketId) {
        disconnected = 1;
        player = game.players[i]; 
        game.players.splice(i, 1);
        game.numberOfPlayers = game.players.length;
        if (game.numberOfPlayers == 0) {
          // delete game from db
          await gameModel.findByIdAndDelete(gameId);
          return;
        } 
        break;
      }
      }
      if (!disconnected) return;
      
    
      if (game.numberOfPlayers > 0) {
        // update current players index
        for (let i = 0; i < game.players.length;i++) {
          game.players[i].index = i;
          io.to(game.players[i].socketId).emit("changeIndex", {
            gameId: gameId,
            playerId: game.players[i].playerId,
            newIndex:i
          });
          io.to(game.players[i].socketId).emit("playerDiconnnected", {
            gameId: gameId,
            playerName: player.name
          });
        }
        await game.save();
        
        let players = [];
            for (let player of game.players) {
              players.push({
                name: player.name,
                index: player.index,
                number: player.cards.length,
                score:player.score
              })
          }
          if (game.gameStart) {
            for (let player of game.players) { 
              io.to(player.socketId).emit("gameUpdated", {
                gameId: gameId,
                players: players,
                currentCard: game.currentCard,
                currentPlayerTurn: game.currentPlayerTurn,
                currenColor: game.currentColor
              });
            }
            
          } else {
            for (let player of game.players) {
              io.to(player.socketId).emit("queueChanged", {
                gameId: game._id,
                players: players
              });
            }
          }
    }  
    
        
    } catch (err) {
      console.log(err);
        socket.emit("errorInRequest",{msg:err.message});
      }
      
    
  });

  socket.on("chatMessage", async (data) => {
    try {
      let gameId = roomId.gameId;
      let name = roomId.playerName;
      if (!gameId || !name) throw new Error("not enough data");
      const game = await gameModel.findById(gameId);
      if (!game) throw new Error("no game with this id");
      game.chat.push({
        playerName: name,
        message: roomId.message
      });
      await game.save();
      // emit the message to all players in the room 
      for (let player of game.players) {
        io.to(player.socketId).emit("messageRecieve", {
          gameId: game._id,
          playerName: name,
          message: roomId.message,
          playerId: roomId.playerId
        });
      }
      
    } catch (err) {
      console.log(err);
      socket.emit("errorInRequest", { msg: err.message });
    }
  });

  socket.on("rematch", async (data) => {
    try {
      if (!roomId.gameId) throw new Error("not enough data");
      let game = await gameModel.findById(roomId.gameId);
      // reset game 
      game = await gameController.resetGame(game);
    let players = [];
    for (let player of game.players) {
      players.push({
        name: player.name,
        index: player.index,
        number: player.cards.length,
        score:player.score
      })
      }
    for (let player of game.players) { 
      io.to(player.socketId).emit("gameCreated", {
        gameId: roomId.gameId,
        players: players,
        currentCard: game.currentCard,
        currentPlayerTurn: game.currentPlayerTurn,
        currenColor:game.currentColor
      });
    }
    
    for (let player of game.players) {
      io.to(player.socketId).emit("getCards", {
        playerId: player.playerId,
        cards: player.cards,
        gameId:roomId.gameId
      });
      }
      
      
    }catch(err){
      socket.emit("errorInRequest",{msg:err.message});
    }
  });


  socket.on("kickPlayer",async (data) => {
    try {
      const gameId = roomId.gameId;
      const game = await gameModel.findById(gameId);
      if (!game) throw new Error("no game with this id");
      if (game.players[0].playerId != roomId.playerId) throw new Error("not the current host");
      if (!roomId.index) throw new Error("not enough data");
      if (roomId.index <= 0 || roomId.index >= game.players.length) throw new Error("cannot remove player with this index");
      io.to(game.players[roomId.index].socketId).emit("kickedPlayer",{gameId:gameId})
      game.players.splice(roomId.index, 1);
      game.numberOfPlayers = game.numberOfPlayers - 1;
      game.markModified("players");
      await game.save();
      // update current players index
      for (let i = 0; i < game.players.length; i++) {
        game.players[i].index = i;
        io.to(game.players[i].socketId).emit("changeIndex", {
          gameId: gameId,
          playerId: game.players[i].playerId,
          newIndex: i
        });
        
      }
 
        
        let players = [];
            for (let player of game.players) {
              players.push({
                name: player.name,
                index: player.index,
                number: player.cards.length,
                score:player.score
              })
          }
          if (game.gameStart) {
            for (let player of game.players) { 
              io.to(player.socketId).emit("gameUpdated", {
                gameId: gameId,
                players: players,
                currentCard: game.currentCard,
                currentPlayerTurn: game.currentPlayerTurn,
                currenColor: game.currentColor
              });
            }
            
          } else {
            for (let player of game.players) {
              io.to(player.socketId).emit("queueChanged", {
                gameId: game._id,
                players: players
              });
            }
          }
      
      
    }catch(err){
      socket.emit("errorInRequest",{msg:err.message});
    }
  })
})





server.listen(process.env.PORT || PORT, () => { console.log(`listening on port ${process.env.PORT || PORT}`) });