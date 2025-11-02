import "dotenv/config";
import express from "express";
import session from "express-session";
import passport from "passport";
import { Strategy as DiscordStrategy } from "passport-discord";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";
import chalk from "chalk";
import expressLayouts from "express-ejs-layouts";
import fetch from "node-fetch";
import Guild from "./models/Guild.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// EJS + Layouts + Static
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);
app.set("layout", "layout");
app.use(express.static(path.join(__dirname, "public")));

// Sessions
app.use(session({
  secret: process.env.SESSION_SECRET || "change-me",
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

// Passport Discord
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

const ADMIN_BIT = 0x8;

passport.use(new DiscordStrategy({
  clientID: process.env.DISCORD_CLIENT_ID,
  clientSecret: process.env.DISCORD_CLIENT_SECRET,
  callbackURL: process.env.DISCORD_CALLBACK_URL,
  scope: ["identify", "guilds"]
}, async (accessToken, refreshToken, profile, done) => {
  try {
    const guilds = profile.guilds || [];
    const target = guilds.find(g => g.id === process.env.GUILD_ID);
    const isAdmin = !!(target && (target.permissions & ADMIN_BIT));
    done(null, { id: profile.id, username: profile.username, avatar: profile.avatar, isAdmin });
  } catch (e) {
    done(null, { id: profile.id, username: profile.username, avatar: profile.avatar, isAdmin: false });
  }
}));

app.use(passport.initialize());
app.use(passport.session());

// Middleware locals (pour les vues)
app.use((req, res, next) => {
  res.locals.user = req.user;
  res.locals.path = req.path;
  next();
});

// MongoDB
(async () => {
  try {
    console.log(chalk.cyan("🧩 Connexion MongoDB..."));
    await mongoose.connect(process.env.MONGO_URI, { dbName: "vouchdb" });
    console.log(chalk.green("✅ MongoDB connecté !"));
  } catch (e) {
    console.error("❌ MongoDB error:", e.message);
    process.exit(1);
  }
})();

// Helpers
function fmtDate(ts) {
  return new Date(ts).toLocaleString("fr-FR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}
function computeLeaderboard(gdata) {
  const counts = new Map();
  (gdata.vouches || []).forEach(v => {
    const key = v.vendorId || v.vendorLabel || "Inconnu";
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return rows.map(([key, n], i) => ({
    rank: i + 1,
    vendor: /^\d+$/.test(key) ? "@" + key : key,
    count: n
  }));
}

const ensureLogged = (req, res, next) =>
  req.user ? next() : res.redirect("/auth/discord");
const ensureAdmin = (req, res, next) =>
  req.user?.isAdmin ? next() : res.status(403).send("Accès refusé (admin requis).");

// Recalculate vouch IDs
async function resequenceGuild(guild) {
  guild.vouches = (guild.vouches || []).slice().sort((a, b) => a.createdAt - b.createdAt);
  let i = 1;
  for (const v of guild.vouches) v.id = i++;
  guild.nextId = (guild.vouches?.length || 0) + 1;
  await guild.save();
}

// ----------- AUTH ROUTES -----------
app.get("/auth/discord", passport.authenticate("discord"));
app.get("/auth/discord/callback",
  passport.authenticate("discord", { failureRedirect: "/login-failed" }),
  (req, res) => res.redirect("/"));
app.get("/logout", (req, res) => req.logout(() => res.redirect("/")));
app.get("/login-failed", (req, res) => res.send("Connexion Discord échouée."));

// ----------- PAGES -----------
app.get("/", (req, res) =>
  res.render("home", { user: req.user, title: "Accueil", path: "/" })
);

app.get("/vouches", ensureLogged, async (req, res) => {
  const gid = process.env.GUILD_ID;
  const guild = (await Guild.findOne({ guildId: gid }).lean()) || { vouches: [], vendors: [], items: [], payments: [] };
  const vouches = (guild.vouches || []).slice().sort((a, b) => b.createdAt - a.createdAt);
  vouches.forEach(v => v.createdAtFmt = fmtDate(v.createdAt));
  res.render("vouches", {
    user: req.user,
    vouches,
    vendors: guild.vendors || [],
    items: guild.items || [],
    payments: guild.payments || [],
    title: "Tous les vouches",
    path: "/vouches"
  });
});

app.get("/leaderboard", ensureLogged, async (req, res) => {
  const gid = process.env.GUILD_ID;
  const guild = (await Guild.findOne({ guildId: gid }).lean()) || { vouches: [], vendors: [] };
  const rows = computeLeaderboard(guild);
  res.render("leaderboard", { user: req.user, rows, title: "Leaderboard", path: "/leaderboard" });
});

app.get("/config", ensureLogged, ensureAdmin, async (req, res) => {
  const gid = process.env.GUILD_ID;
  const guild = (await Guild.findOne({ guildId: gid }).lean()) || { vendors: [], items: [], payments: [] };
  res.render("config", {
    user: req.user,
    gid,
    vendors: guild.vendors || [],
    items: guild.items || [],
    payments: guild.payments || [],
    title: "Configuration",
    path: "/config"
  });
});

// ----------- PAGE PRODUITS -----------
app.get("/products", ensureLogged, async (req, res) => {
  const gid = process.env.GUILD_ID;
  const guild = (await Guild.findOne({ guildId: gid }).lean()) || { products: [] };
  res.render("products", {
    user: req.user,
    products: guild.products || [],
    title: "Produits",
    path: "/products"
  });
});

// ----------- API PRODUITS -----------
app.post("/api/product", ensureLogged, ensureAdmin, async (req, res) => {
  const { name, price, description, image } = req.body;
  const gid = process.env.GUILD_ID;
  const guild = (await Guild.findOne({ guildId: gid })) || await Guild.create({ guildId: gid });

  guild.products = guild.products || [];
  const id = guild.products.length ? guild.products[guild.products.length - 1].id + 1 : 1;
  guild.products.push({ id, name, price, description, image, createdAt: Date.now() });
  await guild.save();

  res.json({ ok: true });
});

app.delete("/api/product/:id", ensureLogged, ensureAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  const gid = process.env.GUILD_ID;
  const guild = await Guild.findOne({ guildId: gid });
  guild.products = (guild.products || []).filter(p => p.id !== id);
  await guild.save();
  res.json({ ok: true });
});

// ✏️ Modification d’un produit
app.put("/api/product/:id", ensureLogged, ensureAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { name, price, description, image } = req.body;
    const gid = process.env.GUILD_ID;
    const guild = await Guild.findOne({ guildId: gid });

    if (!guild || !guild.products) {
      return res.status(404).json({ ok: false, message: "Aucun produit trouvé." });
    }

    const index = guild.products.findIndex(p => p.id === id);
    if (index === -1) {
      return res.status(404).json({ ok: false, message: "Produit introuvable." });
    }

    // Mise à jour du produit
    guild.products[index] = {
      ...guild.products[index],
      name,
      description,
      price,
      image
    };

    await guild.save();
    res.json({ ok: true });
  } catch (err) {
    console.error("Erreur modification produit :", err);
    res.status(500).json({ ok: false, message: "Erreur serveur lors de la modification." });
  }
});

// ----------- API VOUCH -----------
app.post("/api/vouch", ensureLogged, async (req, res) => {
  try {
    const { vendeur, quantite, item, prix, moyen_de_paiement, note, commentaire, anonyme } = req.body;
    const gid = process.env.GUILD_ID;
    const guild = (await Guild.findOne({ guildId: gid })) || await Guild.create({ guildId: gid });

    const vendor = (guild.vendors || []).find(v => v.id === vendeur || v.label === vendeur);
    const vendeurId = vendor && /^\d+$/.test(vendor?.id || "") ? vendor.id : null;
    const vendorLabel = vendor ? vendor.label : vendeur;
    const n = parseInt(note, 10);
    const qty = parseInt(quantite, 10) || 1;
    const anonymous = String(anonyme) === "true";

    const vouch = {
      id: guild.nextId || 1,
      note: isNaN(n) ? 0 : n,
      comment: (commentaire || "").trim(),
      anonymous,
      vendorId: vendeurId,
      vendorLabel,
      item,
      qty,
      prix,
      payment: moyen_de_paiement,
      authorId: req.user.id,
      authorTag: req.user.username,
      authorAvatar: req.user.avatar
        ? `https://cdn.discordapp.com/avatars/${req.user.id}/${req.user.avatar}.png`
        : null,
      createdAt: Date.now(),
      source: "site"
    };

    guild.vouches = guild.vouches || [];
    guild.vouches.push(vouch);
    await resequenceGuild(guild);

    // Envoi Discord webhook
    const webhook = process.env.DISCORD_WEBHOOK_URL;
    if (webhook) {
      const star = (x) => "⭐".repeat(x) + "✩".repeat(5 - x);
      const embed = {
        color: 0xff0000,
        title: `New Vouch ${vouch.anonymous ? "(anonyme)" : `de ${vouch.authorTag}`} (via SITE)`,
        thumbnail: vouch.authorAvatar ? { url: vouch.authorAvatar } : undefined,
        fields: [
          { name: "Note", value: `**${star(vouch.note)}** (${vouch.note}/5)` },
          { name: "Vendeur", value: vouch.vendorLabel || (vouch.vendorId ? `<@${vouch.vendorId}>` : "Inconnu") },
          { name: "Item vendu", value: `x${vouch.qty} ${vouch.item} (${vouch.prix} via ${vouch.payment})` },
          { name: "Vouch N°", value: String(vouch.id), inline: true },
          { name: "Vouch par", value: vouch.anonymous ? "_Anonyme_" : `<@${vouch.authorId}>`, inline: true },
          { name: "Date du vouch", value: new Date(vouch.createdAt).toLocaleString("fr-FR"), inline: true },
          ...(vouch.comment ? [{ name: "Commentaire", value: vouch.comment }] : [])
        ],
        footer: { text: "Service proposé par HOME VOUCH (site web)" }
      };
      try {
        await fetch(webhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ embeds: [embed] })
        });
      } catch {}
    }

    // MAJ du leaderboard sur le bot
    try {
      await fetch("http://localhost:3001/update-leaderboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guildId: process.env.GUILD_ID })
      });
    } catch (err) {
      console.warn("⚠️ Erreur de synchro leaderboard bot :", err.message);
    }

    res.json({ ok: true, id: vouch.id, nextId: guild.nextId });
  } catch (e) {
    console.error(e);
    res.status(400).json({ ok: false, message: e.message || "Erreur" });
  }
});

app.delete("/api/vouch/:id", ensureLogged, ensureAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ ok: false, message: "ID invalide" });
    const gid = process.env.GUILD_ID;
    const guild = (await Guild.findOne({ guildId: gid })) || await Guild.create({ guildId: gid });
    const before = (guild.vouches || []).length;
    guild.vouches = (guild.vouches || []).filter(v => v.id !== id);
    if (guild.vouches.length === before) return res.status(404).json({ ok: false, message: "Vouch introuvable" });
    await resequenceGuild(guild);

    try {
      await fetch("http://localhost:3001/update-leaderboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guildId: process.env.GUILD_ID })
      });
    } catch (err) {
      console.warn("⚠️ Erreur MAJ leaderboard bot :", err.message);
    }

    res.json({ ok: true, nextId: guild.nextId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Erreur suppression" });
  }
});

// ----------- SERVER -----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(chalk.green(`🌐 Site démarré sur http://localhost:${PORT}`)));
