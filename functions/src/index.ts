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
  const newPlayerRef = await playersRef.add({username: player, gameId: gameId});

  const unitTypes = ["Soldier", "Archer", "Wizard", "Knight", "Zombie"];
  const units = [];
  const unitsRef = db.collection("units");

  // Add initial units for the player
  for (const unitType of unitTypes) {
    const unitData = {
      type: unitType,
      gameId: gameId,
      playerId: newPlayerRef.id,
      health: 100, // They should have 100 health each when created
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    const unitRef = await unitsRef.add(unitData);
    const newUnit = {...unitData, id: unitRef.id};
    units.push(newUnit);
  }

  // return new player's ID and the initial units
  return res.send({joined: true, playerId: newPlayerRef.id, units: units});
});

// Healing
app.post("/games/:gameId/players/:playerId/unit/:unitId/heal/:targetId",
    async (req, res) => {
      const gameId = req.params.gameId;
      const playerId = req.params.playerId;
      const unitId = req.params.unitId;
      const targetId = req.params.targetId;

      // Ensure player exists in the game
      const playersRef = db.collection("players");
      const playerSnapshot = await playersRef.doc(playerId).get();

      const playerData = playerSnapshot.data();

      if (!playerSnapshot.exists || playerData && playerData.gameId !== gameId) {
        return res.status(400).send("Player or game does not exist");
      }

      // Retrieve player's unit
      const unitsRef = db.collection("units");
      const healerRef = await unitsRef.doc(unitId).get();
      const targetRef = await unitsRef.doc(targetId).get();

      // Ensure both units exist
      if (!healerRef.exists || !targetRef.exists) {
        return res.status(400).send("Healer or target does not exist");
      }

      const healerData = healerRef.data();
      const targetData = targetRef.data();

      if (!healerData || !targetData) {
        return res.status(400).send("Healer or target does not exist");
      }

      // Check if the healer and target are in the same game
      if (healerData.gameId !== targetData.gameId) {
        return res.status(400).send("Healer and target are not in the same game");
      }

      // Only the Wizard can heal
      if (healerData.type !== "Wizard") {
        return res.status(400).send("Only the Wizard can heal");
      }

      // Increase target's health by a variable amount depending on healer's strength
      const healing = Math.floor(Math.random() * 11) + 15;
      const newHealth = targetData.health + healing;

      // Set max health
      const maxHealth = 100;
      if (newHealth > maxHealth) {
        // Update target's health to max health
        await unitsRef.doc(targetId).update({health: maxHealth});
        return res.send({message: "Healing was successful", healedAmount: healing, targetNewHealth: maxHealth});
      } else {
        // Update target's health
        await unitsRef.doc(targetId).update({health: newHealth});
        return res.send({message: "Healing was successful", healedAmount: healing, targetNewHealth: newHealth});
      }
    });


// Attack another unit
app.post("/games/:gameId/players/:playerId/unit/:unitId/attack/:targetId",
    async (req, res) => {
      const gameId = req.params.gameId;
      const playerId = req.params.playerId;
      const unitId = req.params.unitId;
      const targetId = req.params.targetId;

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
      const attackerRef = await unitsRef.doc(unitId).get();
      const targetRef = await unitsRef.doc(targetId).get();

      // Ensure both units exist
      if (!attackerRef.exists || !targetRef.exists) {
        return res.status(400).send("Attacker or target does not exist");
      }

      const attackerData = attackerRef.data();
      const targetData = targetRef.data();

      if (!attackerData || !targetData) {
        return res.status(400).send("Attacker or target does not exist");
      }

      // Check if the attacker and target are in the same game
      if (attackerData.gameId !== targetData.gameId) {
        return res.status(400).send("Attacker and target are not in the same game");
      }

      // Check if the attacker and target are owned by the same player
      if (attackerData.playerId === targetData.playerId) {
        return res.status(400).send("Attacker and target are owned by the same player");
      }

      const attackerStrength = {
        "Zombie": 12,
        "Soldier": 20,
        "Archer": 10,
        "Wizard": 5,
        "Knight": 18,
      };

      // Decrease target's health by a variable amount depending on attacker's strength
      const damage = Math.floor(Math.random() * 11) +
        attackerStrength[attackerData.type as keyof typeof attackerStrength];
      const newHealth = targetData.health - damage;

      // Check if target's health is below 0
      if (newHealth <= 0) {
        // Delete target unit from database
        await unitsRef.doc(targetId).delete();
        return res.send("Target unit has been killed");
      } else {
        // Update target's health
        await unitsRef.doc(targetId).update({health: newHealth});
        return res.send({message: "Attack was successful", dealtDamage: damage, targetNewHealth: newHealth});
      }
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
