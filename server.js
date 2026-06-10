require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const multer  = require('multer');
const fetch   = require('node-fetch');
const path    = require('path');

const app    = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

async function callGemini(parts) {
  const url = `${GEMINI_URL}?key=${process.env.GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { temperature: 0 }
    })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || 'Gemini error ' + res.status);
  }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
}

app.get('/health', (_, res) => res.json({ ok: true }));

app.post('/analyze', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhuma imagem enviada.' });

    const base64    = req.file.buffer.toString('base64');
    const mediaType = req.file.mimetype || 'image/jpeg';
    const imgPart   = { inline_data: { mime_type: mediaType, data: base64 } };

    const readPrompt = `Você vai ler uma tabela de dados financeiros. Cada linha tem 10 colunas.

Leia CADA LINHA e para cada uma escreva exatamente neste formato:
LINHA N: pos2=[valor] | pos3=[valor] | pos4=[valor] | pos9=[valor] | pos10=[valor]

Conte as células da esquerda para a direita:
- pos2 = segunda célula: número inteiro (cadastros)
- pos3 = terceira célula: valor monetário com $ (valor FTD)
- pos4 = quarta célula: número inteiro pequeno (quantidade FTD)
- pos9 = nona célula: valor monetário com $ (valor depósito)
- pos10 = décima célula: número inteiro (quantidade depósito)

Leia TODAS as linhas visíveis. Não pule nenhuma. Não some ainda.`;

    const step1 = await callGemini([imgPart, { text: readPrompt }]);

    const sumPrompt = `Abaixo está a leitura linha a linha de uma tabela:

${step1}

Some todos os valores de cada posição:
- Soma de todos pos2 → cadastros
- Soma de todos pos3 (sem $) → valor_ftd
- Soma de todos pos4 → qtd_ftd
- Soma de todos pos9 (sem $) → valor_deposito
- Soma de todos pos10 → qtd_deposito

Retorne APENAS este JSON sem markdown:
{"cadastros":<int>,"valor_ftd":<float>,"qtd_ftd":<int>,"valor_deposito":<float>,"qtd_deposito":<int>}`;

    const step2 = await callGemini([{ text: sumPrompt }]);
    const clean = step2.replace(/```json|```/g, '').trim();

    let parsed;
    try { parsed = JSON.parse(clean); }
    catch { const m = clean.match(/\{[\s\S]*\}/); if (m) parsed = JSON.parse(m[0]); else throw new Error('Parse error: ' + clean.slice(0, 100)); }

    res.json({ ok: true, data: parsed, debug: step1 });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
