// const express = require('express');
// const router = express.Router();
// const Product = require('../models/product');
// const Category = require('../models/category');
// const SubCategory = require('../models/subCategory');
// const Brand = require('../models/brand');
// const Poster = require('../models/poster');

// router.get('/', async (req, res) => {
//   try {
//     const latestProduct = await Product.findOne().sort({ updatedAt: -1 });
//     const latestCategory = await Category.findOne().sort({ updatedAt: -1 });
//     const latestSubCategory = await SubCategory.findOne().sort({ updatedAt: -1 });
//     const latestBrand = await Brand.findOne().sort({ updatedAt: -1 });
//     const latestPoster = await Poster.findOne().sort({ updatedAt: -1 });

//     const latestUpdate = Math.max(
//       new Date(latestProduct?.updatedAt || 0).getTime(),
//       new Date(latestCategory?.updatedAt || 0).getTime(),
//       new Date(latestSubCategory?.updatedAt || 0).getTime(),
//       new Date(latestBrand?.updatedAt || 0).getTime(),
//       new Date(latestPoster?.updatedAt || 0).getTime(),
//     );

//     res.json({
//       success: true,
//       lastUpdated: latestUpdate,
//     });
//   } catch (error) {
//     res.status(500).json({ success: false, message: error.message });
//   }
// });

// module.exports = router;
