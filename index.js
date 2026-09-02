// ============================================================
// IMPORTS
// ============================================================
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const asyncHandler = require('express-async-handler');

dotenv.config();

const app = express();

// ============================================================
// MIDDLEWARE
// ============================================================
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',') 
    : ['http://localhost:3000', 'https://ecommerce-render-dyploy.onrender.com'], 
  credentials: true,
}));

// Security headers
try {
  const helmet = require('helmet');
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));
} catch (_) {
  /* optional */
}

// Stripe webhook needs the raw body (must be before express.json)
app.post(
  '/api/webhooks/stripe',
  express.raw({ type: 'application/json' }),
  require('./routes/stripeWebhook')
);

app.use(express.json());
app.use(require('./middleware/notificationCapture'));

app.use('/image/products', express.static('public/products'));
app.use('/image/category', express.static('public/category'));
app.use('/image/poster', express.static('public/posters'));

// ============================================================
// DATABASE CONNECTION
// ============================================================
const connectDB = async () => {
  try {
    if (!process.env.MONGO_URL) {
      throw new Error("MONGO_URL environment variable is missing!");
    }

    await mongoose.connect(process.env.MONGO_URL, {
      serverSelectionTimeoutMS: 5000, // Timeout in 5s if DB is unreachable
    });
    console.log('✅ Connected to MongoDB');
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err.message);
    // Do NOT call process.exit(1) here so the server stays alive for health checks
  }
};

mongoose.connection.on('disconnected', () => {
  console.warn('⚠️ MongoDB disconnected.');
});

mongoose.connection.on('error', (err) => {
  console.error('❌ MongoDB connection error:', err.message);
});

// ============================================================
// MODEL REGISTRATION
// ============================================================
require('./model/productVariant');
require('./model/product');
require('./model/category');
require('./model/subCategory');
require('./model/brand');
require('./model/variantType');
require('./model/variant');
require('./model/couponCode');
require('./model/poster');
require('./model/user');
require('./model/adminUser');
require('./model/order');
require('./model/review');
require('./model/supplier');
require('./model/warehouse');
require('./model/branch');
require('./model/counter');
require('./model/unit');
require('./model/itemTrack');
require('./model/inventory');
require('./model/attendancePolicy');
require('./model/shift');
require('./model/department');
require('./model/designation');
require('./model/employee');
require('./model/attendance');
require('./model/activityLog');
require('./model/leave');
require('./model/holiday');
require('./model/attendanceCorrection');
require('./model/overtimeRequest');
require('./model/settings');
require('./model/company');
require('./model/payment');
require('./model/supplierPayable');
require('./model/salaryStructure');
require('./model/payrollRun');
require('./model/payroll');
require('./model/employeeAdvance');
require('./model/notificationCenterEvent');
require('./model/marketplace');

// ============================================================
// ROUTES
// ============================================================
app.use('/categories', require('./routes/category'));
app.use('/subCategories', require('./routes/subCategory'));
app.use('/brands', require('./routes/brand'));
app.use('/variantTypes', require('./routes/variantType'));
app.use('/variants', require('./routes/variant'));
app.use('/products', require('./routes/product'));
app.use('/couponCodes', require('./routes/couponCode'));
app.use('/posters', require('./routes/poster'));
app.use('/users', require('./routes/user'));
app.use('/admin-users', require('./routes/adminUser'));
app.use('/orders', require('./routes/order'));
app.use('/payment', require('./routes/payment'));
app.use('/notification', require('./routes/notification'));
app.use('/api/notification-center', require('./routes/notificationCenter'));
app.use('/api/reviews', require('./routes/reviewRoute'));
app.use('/api/imei-inventory', require('./routes/imeiInventory'));
app.use('/api/suppliers', require('./routes/supplier')); 
app.use('/api/warehouses', require('./routes/warehouse'));
app.use('/api/branches', require('./routes/branch'));
app.use('/api/products', require('./routes/productMaster'));
app.use('/api/purchase-orders', require('./routes/purchaseOrder'));
app.use('/api/grn', require('./routes/grn'));
app.use('/api/inventory', require('./routes/inventory'));
app.use('/api/customers', require('./routes/customer'));
app.use('/api/sales-orders', require('./routes/salesOrder'));
app.use('/api/sales-returns', require('./routes/salesReturn'));
app.use('/api/repair-tickets', require('./routes/repairTicket'));

// HR / Attendance (Phase 1 — policy, shift, employees, settings)
app.use('/api/settings', require('./routes/settings'));
app.use('/api/attendance-policies', require('./routes/attendancePolicy'));
app.use('/api/shifts', require('./routes/shift'));
app.use('/api/employees', require('./routes/employee'));
app.use('/api/attendances', require('./routes/attendance'));
app.use('/api/holidays', require('./routes/holiday'));
app.use('/api/leaves', require('./routes/leave'));
app.use('/api/attendance-corrections', require('./routes/attendanceCorrection'));
app.use('/api/overtime-requests', require('./routes/overtime'));

// Finance foundation (Phase 1 — company / tenant)
app.use('/api/company', require('./routes/company'));
app.use('/api/platform', require('./routes/platform'));
app.use('/api/marketplace', require('./routes/marketplace'));
app.use('/api/content', require('./routes/content'));
app.use('/api/company/shipping-rules', require('./routes/shippingRule'));
app.use('/api/company/marketplace-orders', require('./routes/companyMarketplaceOrder'));
app.use('/api/company/marketplace-shipments', require('./routes/companyMarketplaceShipment'));
app.use('/api/company/marketplace-couriers', require('./routes/companyMarketplaceCourier'));
app.use('/api/company/marketplace-refunds', require('./routes/companyMarketplaceRefund'));
// Finance Phase 2 — supplier payable
app.use('/api/supplier-payables', require('./routes/supplierPayable'));
// Finance Phase 3 — supplier payments
app.use('/api/supplier-payments', require('./routes/supplierPayment'));
// Finance Phase 4 — salary structures
app.use('/api/salary-structures', require('./routes/salaryStructure'));
// Finance Phase 5 — payroll runs
app.use('/api/payroll-runs', require('./routes/payrollRun'));
// Finance Phase 6 — employee advances
app.use('/api/employee-advances', require('./routes/employeeAdvance'));
// Finance Phase 7 — employee payments (salary + advance disbursement)
app.use('/api/employee-payments', require('./routes/employeePayment'));
// Finance Phase 8 — reports + printable payloads (PDF on-demand client-side)
app.use('/api/finance-reports', require('./routes/financeReport'));
// Tenant- and branch-scoped ERP sales reporting
app.use('/api/sales-reports', require('./routes/salesReport'));
// Tenant- and branch-scoped ERP purchase reporting
app.use('/api/purchase-reports', require('./routes/purchaseReport'));
// Tenant-evidence- and branch-scoped ERP inventory reporting
app.use('/api/inventory-reports', require('./routes/inventoryReport'));
// Tenant- and branch-scoped repair service reporting
app.use('/api/repair-reports', require('./routes/repairReport'));
// Tenant- and branch-scoped operational profit and loss reporting
app.use('/api/profit-loss-reports', require('./routes/profitLossReport'));
// Consolidated tenant- and branch-scoped executive dashboard
app.use('/api/overview-reports', require('./routes/overviewReport'));
// Finance Phase 9 — customer Stripe checkout
app.use('/api/customer-payments', require('./routes/customerPayment'));

// Last Updated Sync Route
const Product = mongoose.model('Product');
const Category = mongoose.model('Category');
const SubCategory = mongoose.model('SubCategory');
const Brand = mongoose.model('Brand');
const Poster = mongoose.model('Poster');

app.get('/lastUpdated', asyncHandler(async (req, res) => {
  const latestProduct = await Product.findOne().sort({ updatedAt: -1 });
  const latestCategory = await Category.findOne().sort({ updatedAt: -1 });
  const latestSubCategory = await SubCategory.findOne().sort({ updatedAt: -1 });
  const latestBrand = await Brand.findOne().sort({ updatedAt: -1 });
  const latestPoster = await Poster.findOne().sort({ updatedAt: -1 });

  const latestUpdate = Math.max(
    new Date(latestProduct?.updatedAt || 0).getTime(),
    new Date(latestCategory?.updatedAt || 0).getTime(),
    new Date(latestSubCategory?.updatedAt || 0).getTime(),
    new Date(latestBrand?.updatedAt || 0).getTime(),
    new Date(latestPoster?.updatedAt || 0).getTime()
  );

  res.status(200).json({
    success: true,
    message: 'Last updated timestamp retrieved successfully',
    lastUpdated: latestUpdate,
  });
}));

app.get('/', (req, res) => {
  res.json({ success: true, message: 'API is working successfully' });
});

// GLOBAL ERROR HANDLER
app.use((err, req, res, next) => {
  console.error('Global error:', { message: err.message });

  const statusCode = err.statusCode || err.status || 500;
  const isOperational = err.isOperational === true;

  res.status(statusCode).json({
    success: false,
    message:
      process.env.NODE_ENV === 'production' && !isOperational
        ? 'Internal server error'
        : err.message,
    data: null,
    errors: err.errors || null,
  });
});

// ============================================================
// START SERVER
// ============================================================
const PORT = process.env.PORT || 5000;

// Listen immediately on 0.0.0.0 so Render detects host port ready
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  await connectDB();
});

process.on('SIGTERM', async () => {
  console.log('SIGTERM received. Closing server...');
  await mongoose.connection.close();
  process.exit(0);
});