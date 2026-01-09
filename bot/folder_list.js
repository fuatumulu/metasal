require('dotenv').config();
const axios = require('axios');

async function listFolders() {
    const token = process.env.VISION_API_TOKEN;
    const cloudApi = 'https://v1.empr.cloud/api/v1';

    if (!token || token === 'your_cloud_token_here' || token === 'Fuatumulu2%%%') {
        console.error('\nHata: VISION_API_TOKEN ayarlanmamış veya varsayılan değerde kalmış.');
        console.log('Lütfen bot/.env dosyasındaki VISION_API_TOKEN alanına geçerli tokenınızı girin.\n');
        return;
    }

    console.log('\n--- Vision Klasörleri Sorgulanıyor ---\n');

    try {
        const response = await axios.get(`${cloudApi}/folders`, {
            headers: { 'X-Token': token }
        });

        const folders = response.data.data?.items || [];

        if (folders.length === 0) {
            console.log('Hiç klasör bulunamadı or Token geçersiz.');
        } else {
            console.log('Bulunan Klasörler:');
            console.log('----------------------------------------------------');
            folders.forEach(folder => {
                console.log(`Klasör Adı : ${folder.name}`);
                console.log(`Klasör ID  : ${folder.id}`);
                console.log('----------------------------------------------------');
            });
            console.log('\nİstediğiniz klasör ID\'sini kopyalayıp bot/.env dosyasındaki VISION_FOLDER_ID alanına yapıştırabilirsiniz.\n');
        }
    } catch (error) {
        if (error.response?.status === 401) {
            console.error('Hata: API Token geçersiz (Unauthorized).');
        } else {
            console.error('Hata oluştu:', error.message);
        }
    }
}

listFolders();
