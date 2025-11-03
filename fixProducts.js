// fixProducts.js
import mongoose from "mongoose";
import "dotenv/config";
import Guild from "./models/Guild.js";

(async () => {
  try {
    console.log("🔧 Connexion à MongoDB...");
    await mongoose.connect(process.env.MONGO_URI, { dbName: "vouchdb" });

    const gid = process.env.GUILD_ID;
    const guild = await Guild.findOne({ guildId: gid });

    if (!guild) {
      console.log("⚠️ Aucun document trouvé pour cette guild ID.");
      process.exit(0);
    }

    console.log(`🧩 ${guild.products?.length || 0} produits trouvés.`);

    // 🧼 Réparer les produits invalides
    guild.products = (guild.products || []).map((p, i) => {
      const fixed = {
        id: typeof p.id === "number" && !isNaN(p.id) ? p.id : i + 1,
        name: p.name?.trim() || "Produit sans nom",
        price: Number(p.price) || 0,
        description: p.description?.trim() || "",
        image: p.image?.trim() || "",
        createdAt: p.createdAt || Date.now(),
      };
      return fixed;
    });

    // Supprimer les doublons d'ID
    const seen = new Set();
    guild.products = guild.products.filter(p => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });

    await guild.save();

    console.log(`✅ Nettoyage terminé avec succès !`);
    console.log(`🧾 ${guild.products.length} produits corrigés et sauvegardés.`);
  } catch (err) {
    console.error("❌ Erreur pendant le nettoyage :", err);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
})();
