const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * Membuat Token JWT untuk Google Service Account
 * @param {string} clientEmail 
 * @param {string} privateKey 
 * @returns {string} Signed JWT Token
 */
function createJWT(clientEmail, privateKey) {
  const header = {
    alg: 'RS256',
    typ: 'JWT'
  };

  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 3600; // valid untuk 1 jam

  const claimSet = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/drive.file',
    aud: 'https://oauth2.googleapis.com/token',
    exp: exp,
    iat: iat
  };

  const base64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
  const base64ClaimSet = Buffer.from(JSON.stringify(claimSet)).toString('base64url');
  const signatureInput = `${base64Header}.${base64ClaimSet}`;

  // Bersihkan format private key jika ada escape character \n
  const formattedKey = privateKey.replace(/\\n/g, '\n');

  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signatureInput);
  const signature = sign.sign(formattedKey, 'base64url');

  return `${signatureInput}.${signature}`;
}

/**
 * Mendapatkan Access Token dari Google OAuth2
 * @param {string} jwtToken 
 * @returns {Promise<string>} Access Token
 */
function getAccessToken(jwtToken) {
  return new Promise((resolve, reject) => {
    const postData = `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwtToken}`;

    const options = {
      hostname: 'oauth2.googleapis.com',
      port: 443,
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.access_token) {
            resolve(json.access_token);
          } else {
            reject(new Error(`Otentikasi Google Drive gagal: ${data}`));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', (e) => reject(e));
    req.write(postData);
    req.end();
  });
}

/**
 * Mengunggah file ke Google Drive
 * @param {string} filePath Path absolut file lokal
 * @param {string} folderId Google Drive Folder ID
 * @param {object} credentials Kredensial service account
 */
async function uploadToGoogleDrive(filePath, folderId, credentials) {
  let { clientEmail, privateKey } = credentials;
  
  if (!privateKey) {
    throw new Error('Kredensial Google Drive tidak lengkap.');
  }

  // Jika menggunakan metode Google Apps Script Web App (untuk akun Gmail personal gratis)
  if (privateKey.trim().startsWith('https://script.google.com/')) {
    console.log(`[Drive Service] Menggunakan metode Google Apps Script (Web App)...`);
    return uploadViaAppsScript(filePath, folderId, privateKey.trim());
  }

  if (!clientEmail) {
    throw new Error('Kredensial email Google Drive tidak lengkap.');
  }

  // Auto-parse jika user memasukkan seluruh isi berkas JSON ke kolom private key
  if (privateKey.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(privateKey);
      privateKey = parsed.private_key;
      if (parsed.client_email) {
        clientEmail = parsed.client_email;
      }
    } catch (e) {
      throw new Error('Format JSON di kolom private key tidak valid: ' + e.message);
    }
  }

  console.log(`[Drive Service] Memulai otentikasi JWT...`);
  const jwt = createJWT(clientEmail, privateKey);
  const accessToken = await getAccessToken(jwt);
  console.log(`[Drive Service] Otentikasi berhasil. Mengunggah file: ${path.basename(filePath)}`);

  return new Promise((resolve, reject) => {
    const fileName = path.basename(filePath);
    const boundary = 'xxxxxxxx-boundary-xxxxxx';
    
    // Metadata file Google Drive
    const metadata = {
      name: fileName,
      mimeType: 'image/png'
    };
    if (folderId) {
      metadata.parents = [folderId];
    }

    const metadataPart = 
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n`;

    const fileHeaderPart = 
      `--${boundary}\r\n` +
      `Content-Type: image/png\r\n\r\n`;

    const fileFooterPart = `\r\n--${boundary}--`;

    const fileContent = fs.readFileSync(filePath);
    
    const bodyBuffer = Buffer.concat([
      Buffer.from(metadataPart),
      Buffer.from(fileHeaderPart),
      fileContent,
      Buffer.from(fileFooterPart)
    ]);

    const options = {
      hostname: 'www.googleapis.com',
      port: 443,
      path: '/upload/drive/v3/files?uploadType=multipart',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': bodyBuffer.length
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.id) {
            console.log(`[Drive Service] File berhasil diunggah! ID: ${json.id}`);
            resolve(json);
          } else {
            reject(new Error(`Gagal upload: ${data}`));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', (e) => reject(e));
    req.write(bodyBuffer);
    req.end();
  });
}

module.exports = {
  uploadToGoogleDrive
};

/**
 * Mengunggah file ke Google Drive via Google Apps Script Web App
 * @param {string} filePath Path absolut file lokal
 * @param {string} folderId Google Drive Folder ID
 * @param {string} webAppUrl URL Web App Google Apps Script
 */
function uploadViaAppsScript(filePath, folderId, webAppUrl) {
  return new Promise((resolve, reject) => {
    try {
      const fileName = path.basename(filePath);
      const fileContent = fs.readFileSync(filePath);
      const base64Image = `data:image/png;base64,${fileContent.toString('base64')}`;

      const payload = JSON.stringify({
        image: base64Image,
        folderId: folderId,
        fileName: fileName
      });

      console.log(`[Drive Service] Mengirim foto ke Google Apps Script...`);
      postRequestWithRedirect(webAppUrl, payload)
        .then(res => {
          if (res && res.success) {
            console.log(`[Drive Service] File berhasil diunggah via Apps Script! ID: ${res.id}`);
            resolve(res);
          } else {
            reject(new Error(res ? res.error : 'Respon kosong dari Apps Script'));
          }
        })
        .catch(err => reject(err));
    } catch (err) {
      reject(err);
    }
  });
}

function postRequestWithRedirect(url, postData) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const options = {
      hostname: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      // Tangani Redirect (301, 302, 307, 308)
      if ([301, 302, 307, 308].includes(res.statusCode)) {
        const redirectUrl = res.headers.location;
        resolve(postRequestWithRedirect(redirectUrl, postData));
        return;
      }

      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ success: false, error: `Response tidak valid dari server: ${data}` });
        }
      });
    });

    req.on('error', (e) => reject(e));
    req.write(postData);
    req.end();
  });
}
