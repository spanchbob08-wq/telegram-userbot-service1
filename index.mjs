import 'dotenv/config';
import express from 'express';

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT || 10000);

app.get('/', (req, res) => {
  res.json({
    ok: true,
    service: 'telegram-userbot-service'
  });
});

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Userbot service started on port ${PORT}`);
});