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
app.use(express.static("public"));

// EJS + Layouts + Static
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);
app.set("layout", "layout");
app.use(express.static(path.join(__dirname, "public")));

// Sessions
app.use(
  session({
    secret: process.env.SESSION_SECRET || "change-me",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 },
  })
);

// Passport Discord
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

const ADMIN_BIT = 0x8;

passport.use(
  new DiscordStrategy(
    {
      clientID: process.env.DISCORD_CLIENT_ID,
      clientSecret: process.env.DISCORD_CLIENT_SECRET,
      callbackURL: process.env.DISCORD_CALLBACK_URL,
      scope: ["identify", "guilds"],
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const guilds = profile.guilds || [];
        const target = guilds.find((g) => g.id === process.env.GUILD_ID);
        const isAdmin = !!(target && target.permissions & ADMIN_BIT);
        done(null, {
          id: profile.id,
          username: profile.username,
          avatar: profile.avatar,
          isAdmin,
        });
      } catch (e) {
        done(null, {
          id: profile.id,
          username: profile.username,
          avatar: profile.avatar,
          isAdmin: false,
        });
      }
    }
  )
);

app.use(passport.initialize());
app.use(passport.session());

// Middleware locals
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
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function computeLeaderboard(gdata) {
  const counts = new Map();
  (gdata.vouches || []).forEach((v) => {
    const key = v.vendorId || v.vendorLabel || "Inconnu";
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return rows.map(([key, n], i) => ({
    rank: i + 1,
    vendor: /^\d+$/.test(key) ? "@" + key : key,
    count: n,
  }));
}

const ensureLogged = (req, res, next) =>
  req.user ? next() : res.redirect("/auth/discord");
const ensureAdmin = (req, res, next) =>
  req.user?.isAdmin
    ? next()
    : res.status(403).send("Accès refusé (admin requis).");

async function resequenceGuild(guild) {
  guild.vouches = (guild.vouches || [])
    .slice()
    .sort((a, b) => a.createdAt - b.createdAt);
  let i = 1;
  for (const v of guild.vouches) v.id = i++;
  guild.nextId = (guild.vouches?.length || 0) + 1;
  await guild.save();
}

// ----------- AUTH ROUTES -----------
app.get("/auth/discord", passport.authenticate("discord"));
app.get(
  "/auth/discord/callback",
  passport.authenticate("discord", { failureRedirect: "/login-failed" }),
  (req, res) => res.redirect("/")
);
app.get("/logout", (req, res) => req.logout(() => res.redirect("/")));
app.get("/login-failed", (req, res) =>
  res.send("Connexion Discord échouée.")
);

// ----------- PAGES -----------
app.get("/", (req, res) =>
  res.render("home", { user: req.user, title: "Accueil", path: "/" })
);

app.get("/vouches", ensureLogged, async (req, res) => {
  const gid = process.env.GUILD_ID;
  const guild =
    (await Guild.findOne({ guildId: gid }).lean()) || {
      vouches: [],
      vendors: [],
      items: [],
      payments: [],
    };
  const vouches = (guild.vouches || [])
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt);
  vouches.forEach((v) => (v.createdAtFmt = fmtDate(v.createdAt)));
  res.render("vouches", {
    user: req.user,
    vouches,
    vendors: guild.vendors || [],
    items: guild.items || [],
    payments: guild.payments || [],
    title: "Tous les vouches",
    path: "/vouches",
  });
});

app.get("/leaderboard", ensureLogged, async (req, res) => {
  const gid = process.env.GUILD_ID;
  const guild =
    (await Guild.findOne({ guildId: gid }).lean()) || {
      vouches: [],
      vendors: [],
    };
  const rows = computeLeaderboard(guild);
  res.render("leaderboard", {
    user: req.user,
    rows,
    title: "Leaderboard",
    path: "/leaderboard",
  });
});

app.get("/config", ensureLogged, ensureAdmin, async (req, res) => {
  const gid = process.env.GUILD_ID;
  const guild =
    (await Guild.findOne({ guildId: gid }).lean()) || {
      vendors: [],
      items: [],
      payments: [],
    };
  res.render("config", {
    user: req.user,
    gid,
    vendors: guild.vendors || [],
    items: guild.items || [],
    payments: guild.payments || [],
    title: "Configuration",
    path: "/config",
  });
});

// ----------- API CONFIG -----------
app.post("/api/config/vendor/add", ensureLogged, ensureAdmin, async (req, res) => {
  try {
    const { id, label } = req.body;
    if (!label || !label.trim())
      return res.status(400).json({ ok: false, message: "Label requis." });

    const gid = process.env.GUILD_ID;
    const guild =
      (await Guild.findOne({ guildId: gid })) ||
      (await Guild.create({ guildId: gid }));

    guild.vendors = guild.vendors || [];
    guild.vendors.push({ id: id?.trim() || null, label: label.trim() });
    await guild.save();
    res.json({ ok: true });
  } catch (err) {
    console.error("❌ Erreur ajout vendeur :", err);
    res.status(500).json({ ok: false, message: "Erreur serveur" });
  }
});

app.post("/api/config/item/add", ensureLogged, ensureAdmin, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim())
      return res.status(400).json({ ok: false, message: "Nom requis." });

    const gid = process.env.GUILD_ID;
    const guild =
      (await Guild.findOne({ guildId: gid })) ||
      (await Guild.create({ guildId: gid }));

    guild.items = guild.items || [];
    if (!guild.items.includes(name.trim())) guild.items.push(name.trim());
    await guild.save();
    res.json({ ok: true });
  } catch (err) {
    console.error("❌ Erreur ajout item :", err);
    res.status(500).json({ ok: false, message: "Erreur serveur" });
  }
});

app.post("/api/config/payment/add", ensureLogged, ensureAdmin, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim())
      return res.status(400).json({ ok: false, message: "Nom requis." });

    const gid = process.env.GUILD_ID;
    const guild =
      (await Guild.findOne({ guildId: gid })) ||
      (await Guild.create({ guildId: gid }));

    guild.payments = guild.payments || [];
    if (!guild.payments.includes(name.trim())) guild.payments.push(name.trim());
    await guild.save();
    res.json({ ok: true });
  } catch (err) {
    console.error("❌ Erreur ajout payment :", err);
    res.status(500).json({ ok: false, message: "Erreur serveur" });
  }
});

// ----------- API PRODUITS -----------
app.get("/products", ensureLogged, async (req, res) => {
  const gid = process.env.GUILD_ID;
  const guild =
    (await Guild.findOne({ guildId: gid }).lean()) || { products: [] };
  res.render("products", {
    user: req.user,
    products: guild.products || [],
    title: "Produits",
    path: "/products",
  });
});

app.post("/api/product", ensureLogged, ensureAdmin, async (req, res) => {
  try {
    const { name, price, description, image } = req.body;
    if (!name?.trim())
      return res.status(400).json({ ok: false, message: "Nom du produit requis." });

    const gid = process.env.GUILD_ID;
    const guild =
      (await Guild.findOne({ guildId: gid })) ||
      (await Guild.create({ guildId: gid }));

    guild.products = guild.products || [];
    guild.products = guild.products.map((p, i) => ({
      ...p,
      id: typeof p.id === "number" && !isNaN(p.id) ? p.id : i + 1,
    }));

    const lastId =
      guild.products.length > 0
        ? guild.products[guild.products.length - 1].id
        : 0;
    const newId = lastId + 1;

    guild.products.push({
      id: newId,
      name: name.trim(),
      price: price ? parseFloat(price) : null,
      description: description?.trim() || "",
      image: image?.trim() || "",
      createdAt: Date.now(),
    });

    await guild.save();
    res.json({ ok: true });
  } catch (err) {
    console.error("❌ Erreur ajout produit :", err);
    res.status(500).json({ ok: false, message: "Erreur serveur" });
  }
});

app.delete("/api/product/:id", ensureLogged, ensureAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id))
      return res.status(400).json({ ok: false, message: "ID invalide" });

    const gid = process.env.GUILD_ID;
    const guild = await Guild.findOne({ guildId: gid });
    if (!guild)
      return res.status(404).json({ ok: false, message: "Guild introuvable" });

    guild.products = (guild.products || []).filter((p) => p.id !== id);
    await guild.save();
    res.json({ ok: true });
  } catch (err) {
    console.error("❌ Erreur suppression produit :", err);
    res.status(500).json({ ok: false, message: "Erreur serveur" });
  }
});

// ----------- SERVER -----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(chalk.green(`🌐 Site démarré sur http://localhost:${PORT}`))
);
