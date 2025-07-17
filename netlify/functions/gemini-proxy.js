// Harici kütüphane yerine Node.js'in dahili, daha stabil olan https modülünü kullanıyoruz.
const https = require('https');

// Bu yardımcı fonksiyon, https isteklerini daha modern bir "Promise" yapısıyla kullanmamızı sağlar.
function httpsRequest(options, postData) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          // Gelen cevabın hem durum kodunu hem de içeriğini döndür
          resolve({
            statusCode: res.statusCode,
            body: JSON.parse(body),
          });
        } catch (e) {
          // Eğer cevap JSON değilse, hatayı düz metin olarak döndür
          resolve({
            statusCode: res.statusCode,
            body: { error: { message: 'API\'den geçersiz JSON yanıtı alındı.', details: body } }
          });
        }
      });
    });

    req.on('error', (e) => {
      reject(e);
    });

    // İstek gövdesini yaz
    req.write(postData);
    req.end();
  });
}

exports.handler = async function (event) {
  // Sadece POST isteklerine izin ver
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    // API Anahtarını Netlify ortam değişkenlerinden güvenli bir şekilde al
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('API anahtarı bulunamadı. Lütfen Netlify ortam değişkenlerini kontrol edin.');
    }

    // Frontend'den gelen veriyi al
    const { prompt, imageBase64Data, isChat = false } = JSON.parse(event.body);
    
    const modelName = "gemini-2.5-flash";
    const hostname = 'generativelanguage.googleapis.com';
    const path = `/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

    let parts = [{ text: prompt }];
    if (imageBase64Data) {
      parts.push({ inlineData: { mimeType: "image/jpeg", data: imageBase64Data } });
    }

    const payload = {
      contents: [{ role: "user", parts: parts }],
    };
    
    // Eğer istek bir sohbet değilse, yapısal JSON formatında cevap iste
    if (!isChat) {
      payload.generationConfig = {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            "simplified_question": { "type": "STRING" },
            "solution_steps": { "type": "STRING" },
            "final_answer": { "type": "STRING" },
            "recommendations": { "type": "STRING" }
          },
          required: ["simplified_question", "solution_steps", "final_answer", "recommendations"]
        }
      };
    }

    const postData = JSON.stringify(payload);

    const options = {
      hostname: hostname,
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const response = await httpsRequest(options, postData);

    // Gemini API'sinden gelen cevabı kontrol et
    if (response.statusCode < 200 || response.statusCode >= 300) {
      console.error('Gemini API Error:', response.body);
      return {
        statusCode: response.statusCode,
        body: JSON.stringify({ message: 'Gemini API tarafından bir hata döndürüldü.', error: response.body.error }),
      };
    }

    // Başarılı cevabı frontend'e geri gönder
    return {
      statusCode: 200,
      body: JSON.stringify(response.body),
    };

  } catch (error) {
    console.error('Proxy Function Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Proxy fonksiyonunda kritik bir hata oluştu.', error: error.message }),
    };
  }
};
