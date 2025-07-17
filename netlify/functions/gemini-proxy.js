// Harici kütüphane yerine Node.js'in dahili https modülünü kullanıyoruz.
const https = require('https');

// Bu yardımcı fonksiyon, https isteklerini daha modern bir "Promise" yapısıyla kullanmamızı sağlar.
function httpsRequest(options, postData) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, body: JSON.parse(body) });
        } catch (e) {
          resolve({ statusCode: res.statusCode, body: { error: { message: 'API\'den geçersiz JSON yanıtı alındı.', details: body } } });
        }
      });
    });
    req.on('error', (e) => { reject(e); });
    req.write(postData);
    req.end();
  });
}

// Tek bir Gemini API çağrısını yöneten fonksiyon
async function callGemini(apiKey, modelName, payload) {
    const hostname = 'generativelanguage.googleapis.com';
    const path = `/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
    const postData = JSON.stringify(payload);
    const options = {
      hostname: hostname,
      path: path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
    };

    const response = await httpsRequest(options, postData);

    if (response.statusCode < 200 || response.statusCode >= 300) {
      // Hata durumunda, hatayı fırlatarak bir sonraki adıma geçilmesini sağla
      throw new Error(`Model ${modelName} başarısız oldu. Durum Kodu: ${response.statusCode}`);
    }
    
    // Cevap geçerli değilse yine hata fırlat
    if (!response.body.candidates || !response.body.candidates[0]?.content?.parts?.[0]?.text) {
        console.error(`Model ${modelName} geçersiz cevap döndü:`, response.body);
        if(response.body.promptFeedback && response.body.promptFeedback.blockReason) {
             throw new Error(`İstek, güvenlik nedeniyle engellendi: ${response.body.promptFeedback.blockReason}`);
        }
        throw new Error(`Model ${modelName} beklenen formatta bir yanıt vermedi.`);
    }

    return response;
}


exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('API anahtarı bulunamadı. Lütfen Netlify ortam değişkenlerini kontrol edin.');
    }

    const { prompt, imageBase64Data, isChat = false } = JSON.parse(event.body);
    
    let parts = [{ text: prompt }];
    if (imageBase64Data && !isChat) {
      parts.push({ inlineData: { mimeType: "image/jpeg", data: imageBase64Data } });
    }

    const payload = { contents: [{ role: "user", parts: parts }] };
    
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

    let response;
    try {
      // 1. Adım: Önce hızlı olan "flash" modelini dene
      console.log("1. deneme: gemini-2.5-flash modeli kullanılıyor...");
      response = await callGemini(apiKey, "gemini-2.5-flash", payload);
      console.log("gemini-2.5-flash başarılı oldu.");

    } catch (flashError) {
      // 2. Adım: Eğer "flash" modeli başarısız olursa, "pro" modelini dene
      console.warn("gemini-2.5-flash başarısız oldu:", flashError.message);
      console.log("2. deneme: gemini-2.5-pro modeline geçiliyor...");
      
      response = await callGemini(apiKey, "gemini-2.5-pro", payload);
      console.log("gemini-2.5-pro başarılı oldu.");
    }

    // Başarılı cevabı frontend'e geri gönder
    return {
      statusCode: 200,
      body: JSON.stringify(response.body),
    };

  } catch (error) {
    // Eğer her iki model de başarısız olursa, son hatayı döndür
    console.error('Tüm denemeler başarısız oldu:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Soru analiz edilirken bir sorun oluştu. Lütfen daha sonra tekrar deneyin.', error: error.message }),
    };
  }
};
