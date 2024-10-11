const TelegramBot = require("node-telegram-bot-api");
const express = require("express");
require("dotenv").config();
const cors = require("cors");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");

// Initialize the Telegram bot with your Telegram API token
const token = process.env.TOKEN;
const bot = new TelegramBot(token, { polling: true });
console.log("Telegram Bot is running");

// MongoDB connection
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected successfully"))
  .catch((err) => console.error("MongoDB connection error:", err));

const userSchema = new mongoose.Schema({
  // Existing fields
  firstName: { type: String, required: true },
  userId: { type: String, required: true, unique: true },
  rewards: { type: Number, default: 0 },
  canClaim: { type: Boolean, default: false },
  timeRemaining: { type: Number, default: 0 },

  // New fields for the staking mechanism
  lastLogin: { type: Date, default: Date.now }, // Stores the timestamp of the last login
  loginStreak: { type: Number, default: 0 }, // Tracks consecutive days of login
  farmingPointsMultiplier: { type: Number, default: 0.14 }, // Multiplier for farming points, starting at 0.15
});

const User = mongoose.model("User", userSchema);

// Create an Express app
const app = express();
app.use(express.json());

const corsOptions = {
  origin: "*", // Restrict this in production
  methods: ["GET", "POST"],
  credentials: true,
};

app.use(cors(corsOptions));

// Handle the /start command
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const { id, first_name: firstName, last_name: lastName = "" } = msg.from;

  // Check if the user already exists in the database
  let user = await User.findOne({ telegramId: id });

  if (!user) {
    // If the user doesn't exist, create a new user in the database
    user = new User({ telegramId: id, firstName, lastName });
    await user.save();
  }

  // Modify the URL to include the user ID as a query parameter
  const inlineKeyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "Launch",
            web_app: {
              url: `https://8ee1-2405-201-e060-50-60ca-b7a9-fc4c-c37c.ngrok-free.app/?userId=${user.telegramId}`,
            },
          },
        ],
      ],
    },
  };

  bot.sendMessage(
    chatId,
    `Welcome, ${user.firstName}! Click the button below to check your stats.`,
    inlineKeyboard
  );
});
bot.onText(/\/start (.+)?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const referrerId = match[1]; // Extract the referrer ID from the referral link (if exists)
  const { id, first_name: firstName, last_name: lastName = "" } = msg.from;

  // Check if the user already exists in the database
  let user = await User.findOne({ telegramId: id });

  if (!user) {
    // If the user doesn't exist, create a new user
    user = new User({ telegramId: id, firstName, lastName });

    // If the referrerId exists, store it
    if (referrerId) {
      user.referredBy = referrerId; // Store the referrer in the user model
    }

    await user.save();
  }

  // Modify the URL to include the user ID as a query parameter
  const inlineKeyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "Launch",
            web_app: {
              url: `https://8ee1-2405-201-e060-50-60ca-b7a9-fc4c-c37c.ngrok-free.app/?userId=${user.telegramId}`,
            },
          },
        ],
      ],
    },
  };

  bot.sendMessage(
    chatId,
    `Welcome, ${user.firstName}! Click the button below to check your stats.`,
    inlineKeyboard
  );

  // If the user was referred by someone, notify the referrer (optional)
  if (referrerId) {
    const referrer = await User.findOne({ telegramId: referrerId });
    if (referrer) {
      bot.sendMessage(
        referrerId,
        `You referred ${user.firstName} ${user.lastName} and earned a reward!`
      );
    }
  }
});
// Generate JWT token for authentication
const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: "1h" });
};
const authenticateJWT = (req, res, next) => {
  const token = req.headers["authorization"]?.split(" ")[1];
  if (token) {
    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
      if (err) {
        return res.sendStatus(403);
      }
      req.user = user;
      next();
    });
  } else {
    res.sendStatus(401);
  }
};
// Fetch user data based on userId (endpoint for the frontend to retrieve user info)
app.get("/api/user/:userId", async (req, res) => {
  const { userId } = req.params;

  try {
    const user = await User.findOne({ telegramId: userId });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const now = new Date();
    const claimInterval = 60 * 1000; // 1 minute for testing, change to 8 hours (8 * 60 * 60 * 1000) for production
    let timeRemaining = 0;
    let canClaim = false;

    // If the user has never claimed, they can claim immediately
    if (!user.lastClaimedAt) {
      canClaim = true;
      timeRemaining = claimInterval / 1000; // Convert milliseconds to seconds
    } else {
      const elapsedTime = now - user.lastClaimedAt; // Calculate elapsed time in milliseconds

      if (elapsedTime >= claimInterval) {
        canClaim = true; // User can claim again
      } else {
        timeRemaining = (claimInterval - elapsedTime) / 1000; // Calculate remaining time in seconds
      }
    }

    res.json({
      id: user.telegramId,
      firstName: user.firstName,
      lastName: user.lastName,
      rewards: user.rewards,
      canClaim,
      timeRemaining, // Send remaining time
    });
  } catch (error) {
    console.error("Error fetching user data:", error);
    res
      .status(500)
      .json({ error: "Internal Server Error", details: error.message });
  }
});

// Claim rewards endpoint
// Claim points endpoint
app.post("/api/user/:userId/claim", async (req, res) => {
  const { userId } = req.params;
  const { points } = req.body;

  try {
    await User.updateOne(
      { telegramId: userId },
      {
        $inc: { rewards: points },
        $set: { hasClaimed: true, lastClaimedAt: new Date() }, // Store current timestamp
      }
    );
    res.status(200).json({ message: "Points claimed successfully." });
  } catch (error) {
    console.error("Error claiming points:", error);
    res
      .status(500)
      .json({ error: "Internal Server Error", details: error.message });
  }
});
bot.onText(/\/referral/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  // Generate a referral link with the userId
  const referralLink = `http://t.me/minx_a_botin?start=${userId}`;

  bot.sendMessage(chatId, `Share your referral link: ${referralLink}`);
});
app.get("/api/referrals/:userId", async (req, res) => {
  const userId = req.params.userId;

  // Find the user in the database and count how many referrals they have
  const referredCount = await User.countDocuments({ referredBy: userId });

  res.json({ referredCount });
});
const updateLoginStreak = async (userId) => {
  const user = await User.findById(userId);

  const currentTime = new Date();
  const lastLoginTime = new Date(user.lastLogin);
  const hoursSinceLastLogin = (currentTime - lastLoginTime) / (1000 * 60 * 60);

  if (hoursSinceLastLogin < 24) {
    user.loginStreak += 1;
    if (user.loginStreak === 7) {
      user.farmingPointsMultiplier += 0.01; // Increase the farming points multiplier after 7 days
      user.loginStreak = 0; // Reset the streak
    }
  } else {
    user.loginStreak = 1; // Reset streak to 1 if more than 24 hours have passed
    user.farmingPointsMultiplier = 0.15; // Reset multiplier
  }

  user.lastLogin = currentTime;
  await user.save();
};

app.post("/api/user/:userId/login", async (req, res) => {
  try {
    await updateLoginStreak(req.params.userId);
    const user = await User.findById(req.params.userId);
    res.status(200).json({
      success: true,
      loginStreak: user.loginStreak,
      farmingPointsMultiplier: user.farmingPointsMultiplier,
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to update streak" });
  }
});

// Start the Express server
const PORT = process.env.PORT;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
