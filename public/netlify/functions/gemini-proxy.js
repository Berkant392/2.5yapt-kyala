// Bu fonksiyon, Netlify'ın sunucularında çalışır.
// API anahtarını güvenli ortam değişkenlerinden alır.
const fetch = require('node-fetch');

exports.handler = async function (event, context) {
  // Sadece POST isteklerine izin ver
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    // API Anahtarını Netlify ortam değişkenlerinden güvenli bir şekilde al
    // ÖNEMLİ: Bu değişkeni Netlify sitenizin ayarlarından eklemeniz gerekir.
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('API anahtarı bulunamadı. Lütfen Netlify ayarlarını kontrol edin.');
    }

    // Frontend'den gelen veriyi al
    const { prompt, imageBase64Data, isChat = false } = JSON.parse(event.body);
    
    const modelName = "gemini-2.5-flash";
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

    // Gemini API'sine gönderilecek payload'ı (veri paketini) oluştur
    let parts = [{ text: prompt }];
    if (imageBase64Data && !isChat) {
      parts.push({ inlineData: { mimeType: "image/jpeg", data: imageBase64Data } });
    }

    const payload = {
      contents: [{ role: "user", parts: parts }],
    };
    
    // Eğer istek bir soru çözümü ise (sohbet değilse), JSON formatında cevap iste
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

    // Gemini API'sine isteği gönder
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    // Gemini API'sinden gelen cevabı kontrol et
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({ error: { message: "API'den geçersiz JSON yanıtı alındı."} }));
      console.error('Gemini API Error:', errorBody);
      return {
        statusCode: response.status,
        body: JSON.stringify({ message: 'Gemini API tarafından bir hata döndürüldü.', error: errorBody.error }),
      };
    }

    const data = await response.json();

    // Başarılı cevabı frontend'e (index.html'e) geri gönder
    return {
      statusCode: 200,
      body: JSON.stringify(data),
    };

  } catch (error) {
    console.error('Proxy Function Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Proxy fonksiyonunda bir hata oluştu.', error: error.message }),
    };
  }
};
