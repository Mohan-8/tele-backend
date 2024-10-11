const TelegramBot = require("node-telegram-bot-api");
const express = require("express");
require("dotenv").config();
const cors = require("cors");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const cron = require("node-cron");

// Initialize the Telegram bot with your Telegram API token
const token = process.env.TOKEN;
const bot = new TelegramBot(token, { polling: true });
console.log("Telegram Bot is running");

// MongoDB connection
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected successfully"))
  .catch((err) => console.error("MongoDB connection error:", err));

// Define the User model
const UserSchema = new mongoose.Schema({
  telegramId: { type: String, required: true, unique: true },
  firstName: { type: String, required: true },
  lastName: { type: String },
  rewards: { type: Number, default: 0 },
  lastClaimedAt: { type: Date }, // Timestamp of last claim
  farmingPoints: { type: Number, default: 0 }, // Add farming points
});

const User = mongoose.model("User", UserSchema);

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

// Fetch user data based on userId (endpoint for the frontend to retrieve user info)
app.get("/api/user/:userId", async (req, res) => {
  const { userId } = req.params;

  try {
    const user = await User.findOne({ telegramId: userId });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const now = new Date();
    const claimInterval = 60 * 1000; // 1 minute for testing, change to 8 hours for production
    let timeRemaining = 0;
    let canClaim = false;

    // Calculate if the user can claim based on their last claimed timestamp
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
      farmingPoints: user.farmingPoints,
      canClaim,
      timeRemaining,
    });
  } catch (error) {
    console.error("Error fetching user data:", error);
    res
      .status(500)
      .json({ error: "Internal Server Error", details: error.message });
  }
});

// Claim rewards endpoint
app.post("/api/user/:userId/claim", async (req, res) => {
  const { userId } = req.params;

  try {
    const user = await User.findOne({ telegramId: userId });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Check if the user can claim rewards
    if (user.farmingPoints <= 0) {
      return res.status(400).json({ error: "No farming points to claim." });
    }

    // Update user's rewards and reset farming points
    await User.updateOne(
      { telegramId: userId },
      {
        $inc: { rewards: user.farmingPoints },
        $set: { farmingPoints: 0, lastClaimedAt: new Date() },
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

// Farming mechanism: Increment farming points periodically
cron.schedule("*/1 * * * *", async () => {
  try {
    // Increment farming points for all users
    await User.updateMany({}, { $inc: { farmingPoints: 0.14 } });
    console.log("Farming points updated for all users.");
  } catch (error) {
    console.error("Error updating farming points:", error);
  }
});

// Start the Express server
const PORT = process.env.PORT;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
