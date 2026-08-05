const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED_TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  // The client's filename is never reused. It can contain "../", a null byte, or collide with an
  // existing file — a random name sidesteps path traversal and overwrites in one move.
  filename: (req, file, cb) => cb(null, crypto.randomUUID() + ALLOWED_TYPES[file.mimetype]),
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_TYPES[file.mimetype]) {
      return cb(new multer.MulterError('UNSUPPORTED_FILE_TYPE'));
    }
    cb(null, true);
  },
});

const startsWith = (buf, bytes) => bytes.every((b, i) => buf[i] === b);

/**
 * Content-Type is supplied by the client, so fileFilter alone would happily accept a script
 * renamed to .png. Reading the real signature is what actually keeps non-images out.
 */
function hasImageSignature(filePath) {
  const buf = Buffer.alloc(12);
  const fd = fs.openSync(filePath, 'r');
  try {
    fs.readSync(fd, buf, 0, 12, 0);
  } finally {
    fs.closeSync(fd);
  }

  const jpeg = startsWith(buf, [0xff, 0xd8, 0xff]);
  const png = startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const webp = startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && buf.subarray(8, 12).toString() === 'WEBP';

  return jpeg || png || webp;
}

function removeQuietly(filePath) {
  if (!filePath) return;
  try {
    fs.unlinkSync(filePath);
  } catch {
    /* already gone */
  }
}

/** Wraps multer so upload failures become JSON responses instead of unhandled errors. */
function uploadImage(fieldName) {
  const handler = upload.single(fieldName);

  return (req, res, next) => {
    handler(req, res, (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ error: `Image must be ${MAX_BYTES / 1024 / 1024} MB or smaller` });
        }
        if (err.code === 'UNSUPPORTED_FILE_TYPE') {
          return res.status(415).json({ error: 'Image must be JPEG, PNG or WebP' });
        }
        return res.status(400).json({ error: 'Image upload failed' });
      }

      if (!req.file) {
        return res.status(400).json({ error: `Expected a file in the "${fieldName}" field` });
      }

      if (!hasImageSignature(req.file.path)) {
        removeQuietly(req.file.path);
        return res.status(415).json({ error: 'File content is not a valid JPEG, PNG or WebP image' });
      }

      next();
    });
  };
}

module.exports = { uploadImage, removeQuietly, UPLOAD_DIR, MAX_BYTES };
