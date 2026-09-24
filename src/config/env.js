const path = require('node:path');
const dotenv = require('dotenv');

dotenv.config({
  path: path.resolve(__dirname, '../../.env'),
});

function required(name) {
  const value = process.env[name];

  if (!value || !value.trim()) {
    throw new Error(`Configuration manquante : ${name}`);
  }

  return value;
}

module.exports = {
  database: {
    host: '127.0.0.1',
    port: 5433,
    database: required('POSTGRES_DB'),
    user: required('POSTGRES_USER'),
    password: required('POSTGRES_PASSWORD'),
  },

  storage: {
    endPoint: '127.0.0.1',
    port: 9000,
    useSSL: false,
    accessKey: required('MINIO_ROOT_USER'),
    secretKey: required('MINIO_ROOT_PASSWORD'),
    bucket: 'webrtc-files',
  },
};