// Prints the chat id of whoever last messaged your bot.
// 1. Create a bot with @BotFather, put the token in .env as TELEGRAM_BOT_TOKEN
// 2. Open your bot in Telegram and send it any message (e.g. "hi")
// 3. Run: npm run telegram:chatid
import { loadEnv } from './util.js';

loadEnv();
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('TELEGRAM_BOT_TOKEN is missing from .env');
  process.exit(1);
}
const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
const data = await res.json();
if (!data.ok && res.status === 409) {
  console.error('This bot has a webhook (JobRadar is running online), so this script cannot read its messages.');
  console.error('Send /start to the bot instead: it replies with your chat id.');
  process.exit(1);
}
if (!data.ok) {
  console.error(`Telegram error: ${data.description}`);
  process.exit(1);
}
const chats = new Map();
for (const u of data.result) {
  const chat = (u.message ?? u.channel_post ?? u.my_chat_member)?.chat;
  if (chat) chats.set(chat.id, chat.title ?? [chat.first_name, chat.last_name].filter(Boolean).join(' '));
}
if (!chats.size) {
  console.log('No messages yet. Send any message to your bot in Telegram, then run this again.');
} else {
  for (const [id, name] of chats) console.log(`TELEGRAM_CHAT_ID=${id}   (${name})`);
}
