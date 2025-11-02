// models/Guild.js
import mongoose from "mongoose";

const guildSchema = new mongoose.Schema({
  // Identifiant Discord du serveur
  guildId: { type: String, required: true, unique: true },

  // --- Vouches ---
  vouches: { type: Array, default: [] },
  nextId: { type: Number, default: 1 },
  vendors: { type: Array, default: [] },
  items: { type: Array, default: [] },
  payments: { type: Array, default: [] },

  // --- Leaderboard ---
  lastLeaderboard: {
    channelId: { type: String, default: null },
    messageId: { type: String, default: null }
  },

  // --- Produits ---
  products: {
    type: [
      {
        id: Number,
        name: String,
        price: Number,
        image: String,
        description: String,
        createdAt: { type: Number, default: () => Date.now() }
      }
    ],
    default: []
  },

  lastProducts: {
    channelId: { type: String, default: null },
    messageId: { type: String, default: null }
  }
});

export default mongoose.model("Guild", guildSchema);
