const { createClient } = require('@supabase/supabase-js');
// .env dosyasından okuyamazsa buraya manuel de yazabilirsin test için
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function check() {
  try {
    const { data, error } = await supabase.from('SeoKnowledgeBase').select('*').limit(1);
    if (error) {
      console.error('❌ Hata:', error.message);
    } else if (data && data.length > 0) {
      console.log('✅ Bulunan Sütunlar:', Object.keys(data[0]));
    } else {
      console.log('⚠️ Tablo boş görünüyor.');
    }
  } catch (e) {
    console.error('💥 Beklenmedik hata:', e.message);
  }
  process.exit();
}
check();
