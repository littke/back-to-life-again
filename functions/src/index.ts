import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import * as express from "express";
import * as cors from "cors";

admin.initializeApp();
const db = admin.firestore();
const app = express();

app.use(cors({origin: true}));

// List all games in the games collection
app.all("/games", async (req, res) => {
  const date24HoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const gamesRef = db.collection("games");
  const snapshot = await gamesRef.where("createdAt", ">", date24HoursAgo).get();

  const games: any[] = [];
  snapshot.forEach((game) => {
    const gameData = game.data();
    gameData.id = game.id;
    games.push({
      name: gameData.name,
      createdAt: gameData.createdAt,
      players: gameData.players,
    });
  });
  return res.send(games);
});

// Create new game in the games collection
app.post("/games/:game", async (req, res) => {
  // get game details from request data
  const game = {
    name: req.params.game,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const gameRef = await db.collection("games").add(game);
  return res.send({id: gameRef.id});
});

// Join an existing game in the games collection
app.post("/games/:gameId/players/:player", async (req, res) => {
  const gameId = req.params.gameId;
  const player = req.params.player;

  const gameRef = db.collection("games").doc(gameId);
  const game = await gameRef.get();

  if (!game.exists) {
    return res.status(404).send("Game does not exist");
  }

  const playersRef = db.collection("players");
  const playerSnapshot = await playersRef.where("username", "==", player)
      .where("gameId", "==", gameId).limit(1).get();

  if (!playerSnapshot.empty) {
    // player with given username already exists in the game
    return res.status(400)
        .send("Player with that username already joined the game");
  }

  // add new player to the game
  await playersRef.add({username: player, gameId: gameId});
  return res.send({joined: true});
});

// Create a new unit for a specific game and player
app.post("/games/:gameId/players/:playerId/units/:unitType",
    async (req, res) => {
      const gameId = req.params.gameId;
      const playerId = req.params.playerId;
      const unitType = req.params.unitType;

      // Check if unit type is valid
      const validUnits = ["Solider", "Archer", "Wizard", "Knight", "Zombie"];
      if (!validUnits.includes(unitType)) {
        return res.status(400)
            .send(`Invalid unit type. 
        Must be one of the following: ${validUnits.join(", ")}`);
      }

      // Ensure player exists in game
      const playersRef = db.collection("players");
      const playerSnapshot = await playersRef.doc(playerId).get();

      if (!playerSnapshot.exists) {
        return res.status(400).send("Player does not exist " +
          "— make sure to provide a playerID, not a username");
      }
      const playerData = playerSnapshot.data();

      if (!playerData || playerData.gameId !== gameId) {
        return res.status(400).send("Game does not exist");
      }

      // Check if player already has five units
      const unitsRef = db.collection("units");
      const unitSnapshot = await unitsRef
          .where("playerId", "==", playerId).get();
      if (unitSnapshot.size >= 5) {
        return res.status(400).send("Player has already created five units");
      }

      // Add new unit to the units collection
      const unit = {
        type: unitType,
        gameId: gameId,
        playerId: playerId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      const unitRef = await unitsRef.add(unit);
      return res.send({id: unitRef.id});
    });

// Get all units for a specific player in a game
app.get("/games/:gameId/players/:playerId/units",
    async (req, res) => {
      const gameId = req.params.gameId;
      const playerId = req.params.playerId;

      // Ensure player exists in the game
      const playersRef = db.collection("players");
      const playerSnapshot = await playersRef.doc(playerId).get();

      const playerData = playerSnapshot.data();

      if (!playerSnapshot.exists ||
          playerData && playerData.gameId !== gameId) {
        return res.status(400).send("Player or game does not exist");
      }

      // Retrieve player's units
      const unitsRef = db.collection("units");
      const unitsSnapshot = await unitsRef
          .where("playerId", "==", playerId).get();

      const units: any[] = [];
      unitsSnapshot.forEach((doc) => {
        const unitData = doc.data();
        unitData.id = doc.id;
        units.push(unitData);
      });

      return res.send(units);
    });


exports.app = functions.https.onRequest(app);
