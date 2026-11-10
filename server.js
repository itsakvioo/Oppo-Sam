require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Environment Variables
const {
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHANNEL_ID,
  META_PIXEL_ID,
  META_ACCESS_TOKEN,
  META_EVENT_NAME
} = process.env;

const TG = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

// 1. Generate Unique Link for every visitor
app.get('/api/config', async (req, res) => {
  try {
    const tgRes = await fetch(`${TG}/createChatInviteLink`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHANNEL_ID,
        creates_join_request: true // Requires admin approval
      })
    });
    const tgData = await tgRes.json();

    if (tgData.ok) {
      res.json({ inviteLink: tgData.result.invite_link });
    } else {
      console.error('Telegram Error:', tgData);
      res.status(500).json({ error: 'Failed to create link' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// 2. Receive Join Request & Approve
app.post('/webhook/telegram', async (req, res) => {
  const update = req.body;
  res.sendStatus(200); 

  try {
    if (update.chat_join_request) {
      const { chat, from } = update.chat_join_request;
      const userId = from.id;
      const chatId = chat.id;

      console.log(`Join request received from: ${from.username || userId}`);

      // Try to approve the user
      const approveRes = await fetch(`${TG}/approveChatJoinRequest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, user_id: userId }),
      });
      
      const approveJson = await approveRes.json();
      
      if (!approveJson.ok) {
        // If it fails (e.g., USER_ALREADY_PARTICIPANT), log it but DO NOT stop the script
        console.error('Telegram approval notice:', approveJson.description);
      } else {
        console.log(`Successfully approved user ${userId}.`);
      }

      // ALWAYS Send conversion to Meta, even if Telegram said they were already in
      await sendMetaConversion(userId, from);
    }
  } catch (err) {
    console.error('Webhook processing error:', err);
  }
});

// 3. Meta Conversions API
async function sendMetaConversion(userId, tgUser) {
  const eventTime = Math.floor(Date.now() / 1000);
  const externalId = crypto.createHash('sha256').update(String(userId)).digest('hex');

  // This line uses the Environment Variable, or defaults to 'Lead' if not set
  const eventNameToSend = META_EVENT_NAME || 'Lead';

  const payload = {
    data: [{
      event_name: eventNameToSend,
      event_time: eventTime,
      action_source: 'website',
      user_data: { external_id: [externalId] },
      custom_data: { source: 'telegram_join', telegram_username: tgUser.username || '' },
    }],
  };

  const url = `https://graph.facebook.com/v18.0/${META_PIXEL_ID}/events?access_token=${META_ACCESS_TOKEN}`;

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await r.json();
    console.log(`Meta CAPI Response (${eventNameToSend}):`, JSON.stringify(json));
  } catch (error) {
    console.error('Error sending Meta CAPI event:', error);
  }
}

app.get('/health', (req, res) => res.send('Server is running!'));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));
