const multer = require('multer');
const path = require('path');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const dotenv = require('dotenv');

dotenv.config(); 

// 1. CONFIGURE CLOUDINARY
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Common file filter (can remain the same)
const fileFilter = (req, file, cb) => {
    const filetypes = /jpeg|jpg|png/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    if (extname) {
      cb(null, true);
    } else {
      cb(new Error("Error: only .jpeg, .jpg, .png files are allowed!"));
    }
};

// 2. STORAGE CONFIGURATION (Replaces multer.diskStorage)

const storageCategory = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'ecommerce-category', 
        allowed_formats: ['jpg', 'png', 'jpeg'],
    },
});

const storageProduct = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'ecommerce-products', 
        allowed_formats: ['jpg', 'png', 'jpeg'],
    },
});

const storagePoster = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'ecommerce-posters', 
        allowed_formats: ['jpg', 'png', 'jpeg'],
    },
});

// 3. MULTER CONFIGURATION

const uploadCategory = multer({
    storage: storageCategory,
    limits: { fileSize: 1024 * 1024 * 5 },
    fileFilter: fileFilter 
});

const uploadProduct = multer({
    storage: storageProduct,
    limits: { fileSize: 1024 * 1024 * 5 },
    fileFilter: fileFilter
});

const uploadPosters = multer({
    storage: storagePoster,
    limits: { fileSize: 1024 * 1024 * 5 },
    fileFilter: fileFilter
});


module.exports = {
    uploadCategory,
    uploadProduct,
    uploadPosters,
};