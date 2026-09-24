const Minio = require('minio');
const config = require('./env');

const { bucket, ...connectionOptions } = config.storage;

const storage = new Minio.Client(connectionOptions);

async function ensureBucket() {
  const exists = await storage.bucketExists(bucket);

  if (!exists) {
    try {
      await storage.makeBucket(bucket, 'us-east-1');
    } catch (error) {
      if (error.code !== 'BucketAlreadyOwnedByYou') {
        throw error;
      }
    }
  }
}

module.exports = {
  storage,
  bucket,
  ensureBucket,
};