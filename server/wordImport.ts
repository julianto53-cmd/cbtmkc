import crypto from 'crypto';
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import fs from 'fs';
import mammoth from 'mammoth';
import path from 'path';
import { QuestionType } from './grading.js';

export interface ParsedWordQuestion {
  tempId: string;
  qType: QuestionType;
  promptText: string;
  imageUrl: string;
  options: any;
  answerKey: any;
  maxScore: number;
  difficultyTag: string;
  explanation: string;
  warnings: string[];
}

export async function generateWordTemplateBuffer(): Promise<Buffer> {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            text: 'TEMPLATE IMPORT SOAL MKC CBT',
            heading: HeadingLevel.HEADING_1,
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: 'Panduan Pengisian: Setiap soal diawali nomor urut (1., 2., dst). Anda dapat menyisipkan gambar langsung di bawah teks soal. Jangan ubah tag [TIPE: ...], [BOBOT: ...], [KUNCI: ...].',
                italics: true,
              }),
            ],
          }),
          new Paragraph({ text: '' }),

          // Sample 1: PG
          new Paragraph({ text: '1. [TIPE: PG] [BOBOT: 10]' }),
          new Paragraph({ text: 'Ibu kota negara Republik Indonesia saat ini adalah...' }),
          new Paragraph({ text: 'A. Bandung' }),
          new Paragraph({ text: 'B. Jakarta' }),
          new Paragraph({ text: 'C. Surabaya' }),
          new Paragraph({ text: 'D. Medan' }),
          new Paragraph({ text: 'E. Semarang' }),
          new Paragraph({ text: '[KUNCI: B]' }),
          new Paragraph({ text: '[PEMBAHASAN: Jakarta merupakan ibu kota resmi yang tercantum dalam contoh dasar.]' }),
          new Paragraph({ text: '' }),

          // Sample 2: PGK
          new Paragraph({ text: '2. [TIPE: PGK] [BOBOT: 15]' }),
          new Paragraph({ text: 'Pilihlah pernyataan yang termasuk perangkat keras masukan (input device) pada komputer! (Jawaban lebih dari satu)' }),
          new Paragraph({ text: 'A. Keyboard mekanik' }),
          new Paragraph({ text: 'B. Tetikus (Mouse)' }),
          new Paragraph({ text: 'C. Monitor LED' }),
          new Paragraph({ text: 'D. Pemindai (Scanner)' }),
          new Paragraph({ text: '[KUNCI: A, B, D]' }),
          new Paragraph({ text: '[PEMBAHASAN: Keyboard, Mouse, dan Scanner adalah perangkat input; Monitor adalah perangkat output.]' }),
          new Paragraph({ text: '' }),

          // Sample 3: BS
          new Paragraph({ text: '3. [TIPE: BS] [BOBOT: 15]' }),
          new Paragraph({ text: 'Tentukan Benar (B) atau Salah (S) dari pernyataan berikut:' }),
          new Paragraph({ text: '1) CPU berfungsi sebagai unit pemroses utama dalam komputer.' }),
          new Paragraph({ text: '2) RAM menyimpan data secara permanen meskipun listrik padam.' }),
          new Paragraph({ text: '[KUNCI: 1=B, 2=S]' }),
          new Paragraph({ text: '[PEMBAHASAN: RAM bersifat volatile sehingga data hilang saat daya dimatikan.]' }),
          new Paragraph({ text: '' }),

          // Sample 4: JODOH
          new Paragraph({ text: '4. [TIPE: JODOH] [BOBOT: 15]' }),
          new Paragraph({ text: 'Pasangkan ekstensi berkas berikut dengan jenisnya:' }),
          new Paragraph({ text: 'L1. .docx => R1. Dokumen Pengolah Kata' }),
          new Paragraph({ text: 'L2. .xlsx => R2. Lembar Kerja Elektronik' }),
          new Paragraph({ text: 'L3. .png => R3. Berkas Gambar Grafis' }),
          new Paragraph({ text: '[KUNCI: L1=R1, L2=R2, L3=R3]' }),
          new Paragraph({ text: '[PEMBAHASAN: Ekstensi .docx untuk Word, .xlsx untuk Excel, .png untuk gambar.]' }),
          new Paragraph({ text: '' }),

          // Sample 5: ISIAN
          new Paragraph({ text: '5. [TIPE: ISIAN] [BOBOT: 10]' }),
          new Paragraph({ text: 'Protokol standar untuk mengamankan lalu lintas web dengan enkripsi TLS adalah...' }),
          new Paragraph({ text: '[KUNCI: HTTPS | https]' }),
          new Paragraph({ text: '[PEMBAHASAN: HTTPS (Hypertext Transfer Protocol Secure) mengenkripsi komunikasi web.]' }),
          new Paragraph({ text: '' }),

          // Sample 6: ESAI
          new Paragraph({ text: '6. [TIPE: ESAI] [BOBOT: 25]' }),
          new Paragraph({ text: 'Jelaskan mengapa topologi star banyak digunakan pada laboratorium komputer sekolah modern!' }),
          new Paragraph({ text: '[KUNCI: Mudah dikelola, jika satu kabel putus tidak mengganggu komputer lain, mudah mendeteksi gangguan.]' }),
          new Paragraph({ text: '[PEMBAHASAN: Penilaian esai diperiksa manual berdasarkan kelengkapan poin alasan teknis.]' }),
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

export async function parseWordDocx(buffer: Buffer, questionUploadsDir: string): Promise<ParsedWordQuestion[]> {
  const allowedMimes: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
  };

  const result = await mammoth.convertToHtml(
    { buffer },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        const ext = allowedMimes[image.contentType] || 'png';
        const imgBuf = await image.read();
        const filename = `word_${crypto.randomUUID()}.${ext}`;
        const dest = path.resolve(questionUploadsDir, filename);
        if (!dest.startsWith(path.resolve(questionUploadsDir) + path.sep)) {
          throw new Error('Invalid image path');
        }
        fs.writeFileSync(dest, imgBuf);
        return { src: `/uploads/questions/${filename}` };
      }),
    }
  );

  // Extract paragraph blocks preserving embedded <img src="..."> tokens
  const html = result.value || '';
  const blockMatches = html.match(/<(p|li|h[1-6])[^>]*>[\s\S]*?<\/\1>/gi) || [];

  const lines: string[] = [];
  for (const block of blockMatches) {
    // Replace <img ... src="..."> with marker [[IMG:url]]
    const withImgMarker = block.replace(/<img[^>]+src="([^"]+)"[^>]*>/gi, ' [[IMG:$1]] ');
    const stripped = decodeHtmlEntities(withImgMarker.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
    if (stripped) lines.push(stripped);
  }

  // Group into question blocks starting with `1. [TIPE: ...]` or `1.`
  const questionStartRe = /^(\d+)\.\s*(?:\[TIPE:\s*(PG|PGK|BS|JODOH|ISIAN|ESAI)\s*\])?(.*)$/i;
  const blocks: Array<{ rawLines: string[]; explicitType?: QuestionType; restFirstLine: string }> = [];

  for (const line of lines) {
    const match = line.match(questionStartRe);
    if (match && (match[2] || blocks.length > 0 || line.includes('[TIPE:'))) {
      // Avoid splitting numbered BS statements like "1)"
      if (/^\d+\)/.test(line)) {
        if (blocks.length > 0) blocks[blocks.length - 1].rawLines.push(line);
        continue;
      }
      blocks.push({
        rawLines: [line],
        explicitType: match[2] ? (match[2].toUpperCase() as QuestionType) : undefined,
        restFirstLine: match[3] || '',
      });
    } else if (blocks.length > 0) {
      blocks[blocks.length - 1].rawLines.push(line);
    }
  }

  const parsed: ParsedWordQuestion[] = [];

  for (const b of blocks) {
    const warnings: string[] = [];
    let qType: QuestionType = b.explicitType || 'PG';
    let maxScore = 10;
    let rawKey = '';
    let explanation = '';
    let imageUrl = '';
    const promptParts: string[] = [];
    const pgOptions: Array<{ id: string; text: string }> = [];
    const bsStatements: Array<{ id: string; statement: string }> = [];
    const jodohLeft: Array<{ id: string; text: string }> = [];
    const jodohRight: Array<{ id: string; text: string }> = [];
    const jodohDefaultPairs: Record<string, string> = {};

    for (let i = 0; i < b.rawLines.length; i++) {
      let line = b.rawLines[i];

      // Extract image marker if present
      const imgMatch = line.match(/\[\[IMG:([^\]]+)\]\]/);
      if (imgMatch) {
        if (!imageUrl) imageUrl = imgMatch[1];
        line = line.replace(/\[\[IMG:[^\]]+\]\]/g, '').trim();
      }

      // Extract tags
      const tipeMatch = line.match(/\[TIPE:\s*(PG|PGK|BS|JODOH|ISIAN|ESAI)\s*\]/i);
      if (tipeMatch) {
        qType = tipeMatch[1].toUpperCase() as QuestionType;
        line = line.replace(tipeMatch[0], '').trim();
      }
      const bobotMatch = line.match(/\[BOBOT:\s*(\d+(?:\.\d+)?)\s*\]/i);
      if (bobotMatch) {
        maxScore = Number(bobotMatch[1]) || 10;
        line = line.replace(bobotMatch[0], '').trim();
      }
      const kunciMatch = line.match(/\[KUNCI:\s*([^\]]+)\]/i);
      if (kunciMatch) {
        rawKey = kunciMatch[1].trim();
        continue;
      }
      const pembMatch = line.match(/\[PEMBAHASAN:\s*([^\]]+)\]/i);
      if (pembMatch) {
        explanation = pembMatch[1].trim();
        continue;
      }

      if (i === 0) {
        line = line.replace(/^\d+\.\s*/, '').trim();
      }
      if (!line) continue;

      // Option A. ...
      const optMatch = line.match(/^([A-E])[.)]\s+(.+)$/i);
      if (optMatch) {
        pgOptions.push({ id: optMatch[1].toUpperCase(), text: optMatch[2].trim() });
        continue;
      }

      // BS statement 1) ...
      const bsMatch = line.match(/^(\d+)\)\s+(.+)$/);
      if (bsMatch && qType === 'BS') {
        bsStatements.push({ id: bsMatch[1], statement: bsMatch[2].trim() });
        continue;
      }

      // JODOH L1. left => R1. right
      const jodohMatch = line.match(/^(L\d+)[.)]\s*(.+?)\s*(?:=>|->|=)\s*(R\d+)[.)]\s*(.+)$/i);
      if (jodohMatch) {
        const lid = jodohMatch[1].toUpperCase();
        const rid = jodohMatch[3].toUpperCase();
        jodohLeft.push({ id: lid, text: jodohMatch[2].trim() });
        jodohRight.push({ id: rid, text: jodohMatch[4].trim() });
        jodohDefaultPairs[lid] = rid;
        continue;
      }

      promptParts.push(line);
    }

    const promptText = promptParts.join('\n').trim();
    if (!promptText) warnings.push('Teks soal kosong');

    let options: any = {};
    let answerKey: any = {};

    if (qType === 'PG') {
      options = pgOptions;
      if (pgOptions.length < 2) warnings.push('Opsi pilihan ganda kurang dari 2');
      const keyChar = rawKey.toUpperCase().replace(/[^A-E]/g, '').slice(0, 1);
      if (!keyChar) warnings.push('Kunci jawaban PG belum terisi');
      answerKey = { correct: keyChar || 'A' };
    } else if (qType === 'PGK') {
      options = pgOptions;
      if (pgOptions.length < 2) warnings.push('Opsi PGK kurang dari 2');
      const keys = rawKey.split(/[,;\s]+/).map((s) => s.trim().toUpperCase()).filter((s) => /^[A-E]$/.test(s));
      if (keys.length === 0) warnings.push('Kunci jawaban PGK belum terisi');
      answerKey = { correct: keys, partialCredit: true };
    } else if (qType === 'BS') {
      options = bsStatements.length > 0 ? bsStatements : [{ id: '1', statement: promptText }];
      const map: Record<string, string> = {};
      if (rawKey.includes('=')) {
        for (const pair of rawKey.split(',')) {
          const [k, v] = pair.split('=').map((x) => x.trim().toUpperCase());
          if (k && (v === 'B' || v === 'S')) map[k] = v;
        }
      } else if (rawKey.toUpperCase() === 'B' || rawKey.toUpperCase() === 'S') {
        map['1'] = rawKey.toUpperCase();
      }
      if (Object.keys(map).length === 0) warnings.push('Kunci Benar/Salah belum valid (contoh: 1=B, 2=S)');
      answerKey = { correct: map };
    } else if (qType === 'JODOH') {
      options = { left: jodohLeft, right: jodohRight };
      const pairs: Record<string, string> = { ...jodohDefaultPairs };
      if (rawKey.includes('=')) {
        for (const p of rawKey.split(',')) {
          const [l, r] = p.split('=').map((x) => x.trim().toUpperCase());
          if (l && r) pairs[l] = r;
        }
      }
      if (jodohLeft.length === 0) warnings.push('Pasangan menjodohkan kosong');
      answerKey = { pairs };
    } else if (qType === 'ISIAN') {
      options = { caseSensitive: false };
      const accepted = rawKey.split('|').map((s) => s.trim()).filter(Boolean);
      if (accepted.length === 0) warnings.push('Kunci isian singkat belum terisi');
      answerKey = { accepted };
    } else if (qType === 'ESAI') {
      options = { rubric: explanation || 'Penilaian manual guru' };
      answerKey = { referenceAnswer: rawKey || '' };
    }

    parsed.push({
      tempId: crypto.randomUUID(),
      qType,
      promptText,
      imageUrl,
      options,
      answerKey,
      maxScore,
      difficultyTag: 'Sedang',
      explanation,
      warnings,
    });
  }

  return parsed;
}
