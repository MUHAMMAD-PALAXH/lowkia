const fs = require("fs");
const path = require("path");

const LOCALES = [
  "bn", "ar", "es", "fr", "de", "pt", "ru", "tr", "zh", "ja",
  "ko", "hi", "ur", "id", "vi", "it", "nl", "th", "fa",
];

const PRIORITY_EN = [
  "Authentication token is missing.",
  "Authentication required.",
  "Token expired. Please login again.",
  "User not found.",
  "Your account has been deleted.",
  "Permission denied.",
  "Company context is required.",
  "Validation failed.",
  "Internal server error",
  "A record with this code already exists. Please retry — the system will allocate the next available code.",
  "Registration started. Check email for OTP.",
  "This account has been blocked. Contact an administrator.",
  "Invalid token.",
  "Access denied.",
  "Only admin can access this resource.",
  "Global Super Admin access required.",
  "Your account is {status}.",
  "Invalid OTP",
  "Invalid OTP.",
  "OTP expired.",
  "OTP verified successfully.",
  "OTP sent to your email.",
  "OTP sent successfully.",
  "Login successful.",
  "Logged out successfully.",
  "Password reset successfully.",
  "Password updated successfully.",
  "Profile updated successfully.",
  "Account created. Verify your email.",
  "Email already registered.",
  "Server error",
  "Request failed",
  "Not found.",
  "Sales order not found.",
  "Purchase order not found.",
  "Product not found.",
  "Customer not found.",
  "Supplier not found.",
  "GRN not found.",
  "Branch not found.",
  "Warehouse not found.",
  "Cannot sell to a blocked customer.",
  "Only Draft purchase orders can be submitted.",
  "Inventory already updated — GRN is locked.",
  "You cannot approve your own payment request.",
  "Unable to generate a unique barcode. Please try again.",
  "Reason is required.",
  "Preview only. Global Super Admin cannot modify company data.",
  "API is working successfully",
  "Last updated timestamp retrieved successfully",
  "Notifications marked as read.",
  "Blog post not found.",
  "Page not found.",
  "Category created successfully.",
  "Category updated successfully.",
  "Category deleted successfully.",
  "Brand created successfully.",
  "Brand updated successfully.",
  "Brand deleted successfully.",
  "Product created successfully.",
  "Product updated successfully.",
  "Product deleted successfully.",
  "Something went wrong",
  "Please fill all required fields.",
  "Update failed.",
  "Update failed",
  "Save failed",
  "Create failed",
  "Delete failed",
  "Failed",
  "Enter failed",
  "Checkout failed",
  "Submit failed",
  "Unable to load plans.",
  "Unable to load plan",
  "Failed to load",
  "Failed to delete account",
  "Could not remove photo",
  "Could not delete account.",
  "OTP request failed.",
  "Failed to send OTP",
  "Failed to resend",
  "Signup failed",
  "Approve failed",
  "Reject failed",
  "Remove failed",
  "Upload failed",
];

const BN = {
  "Authentication token is missing.": "প্রমাণীকরণ টোকেন অনুপস্থিত।",
  "Authentication required.": "প্রমাণীকরণ প্রয়োজন।",
  "Token expired. Please login again.": "টোকেনের মেয়াদ শেষ। আবার লগইন করুন।",
  "User not found.": "ব্যবহারকারী পাওয়া যায়নি।",
  "Your account has been deleted.": "আপনার অ্যাকাউন্ট মুছে ফেলা হয়েছে।",
  "Permission denied.": "অনুমতি প্রত্যাখ্যান করা হয়েছে।",
  "Company context is required.": "কোম্পানি প্রসঙ্গ প্রয়োজন।",
  "Validation failed.": "যাচাইকরণ ব্যর্থ হয়েছে।",
  "Internal server error": "অভ্যন্তরীণ সার্ভার ত্রুটি",
  "A record with this code already exists. Please retry — the system will allocate the next available code.":
    "এই কোডের একটি রেকর্ড ইতিমধ্যে আছে। আবার চেষ্টা করুন — সিস্টেম পরবর্তী কোড বরাদ্দ করবে।",
  "Registration started. Check email for OTP.":
    "নিবন্ধন শুরু হয়েছে। OTP-এর জন্য ইমেইল দেখুন।",
  "This account has been blocked. Contact an administrator.":
    "এই অ্যাকাউন্ট ব্লক করা হয়েছে। প্রশাসকের সাথে যোগাযোগ করুন।",
  "Invalid credentials.": "অবৈধ লগইন তথ্য।",
  "Invalid OTP": "অবৈধ OTP",
  "Invalid OTP.": "অবৈধ OTP।",
  "OTP expired.": "OTP-এর মেয়াদ শেষ।",
  "OTP verified successfully.": "OTP সফলভাবে যাচাই হয়েছে।",
  "OTP sent to your email.": "আপনার ইমেইলে OTP পাঠানো হয়েছে।",
  "OTP sent successfully.": "OTP সফলভাবে পাঠানো হয়েছে।",
  "Login successful.": "লগইন সফল।",
  "Logged out successfully.": "সফলভাবে লগআউট হয়েছে।",
  "Password reset successfully.": "পাসওয়ার্ড সফলভাবে রিসেট হয়েছে।",
  "Password updated successfully.": "পাসওয়ার্ড সফলভাবে আপডেট হয়েছে।",
  "Profile updated successfully.": "প্রোফাইল সফলভাবে আপডেট হয়েছে।",
  "Account created. Verify your email.":
    "অ্যাকাউন্ট তৈরি হয়েছে। আপনার ইমেইল যাচাই করুন।",
  "Email already registered.": "ইমেইল ইতিমধ্যে নিবন্ধিত।",
  "Server error": "সার্ভার ত্রুটি",
  "Request failed": "অনুরোধ ব্যর্থ",
  "Not found.": "পাওয়া যায়নি।",
  "Sales order not found.": "বিক্রয় অর্ডার পাওয়া যায়নি।",
  "Purchase order not found.": "ক্রয় অর্ডার পাওয়া যায়নি।",
  "Product not found.": "পণ্য পাওয়া যায়নি।",
  "Customer not found.": "গ্রাহক পাওয়া যায়নি।",
  "Supplier not found.": "সরবরাহকারী পাওয়া যায়নি।",
  "GRN not found.": "GRN পাওয়া যায়নি।",
  "Branch not found.": "শাখা পাওয়া যায়নি।",
  "Warehouse not found.": "গুদাম পাওয়া যায়নি।",
  "Cannot sell to a blocked customer.":
    "ব্লক করা গ্রাহকের কাছে বিক্রি করা যায় না।",
  "Only Draft purchase orders can be submitted.":
    "শুধুমাত্র ড্রাফট ক্রয় অর্ডার জমা দেওয়া যায়।",
  "Inventory already updated — GRN is locked.":
    "ইনভেন্টরি ইতিমধ্যে আপডেট — GRN লক করা আছে।",
  "You cannot approve your own payment request.":
    "আপনি নিজের পেমেন্ট অনুরোধ অনুমোদন করতে পারবেন না।",
  "Unable to generate a unique barcode. Please try again.":
    "অনন্য বারকোড তৈরি করা যায়নি। আবার চেষ্টা করুন।",
  "Reason is required.": "কারণ প্রয়োজন।",
  "Preview only. Global Super Admin cannot modify company data.":
    "শুধু প্রিভিউ। গ্লোবাল সুপার অ্যাডমিন কোম্পানি ডেটা পরিবর্তন করতে পারে না।",
  "API is working successfully": "API সফলভাবে কাজ করছে",
  "Notifications marked as read.": "বিজ্ঞপ্তি পঠিত হিসেবে চিহ্নিত।",
  "Blog post not found.": "ব্লগ পোস্ট পাওয়া যায়নি।",
  "Page not found.": "পৃষ্ঠা পাওয়া যায়নি।",
  "Category created successfully.": "ক্যাটাগরি সফলভাবে তৈরি হয়েছে।",
  "Category updated successfully.": "ক্যাটাগরি সফলভাবে আপডেট হয়েছে।",
  "Category deleted successfully.": "ক্যাটাগরি সফলভাবে মুছে ফেলা হয়েছে।",
  "Brand created successfully.": "ব্র্যান্ড সফলভাবে তৈরি হয়েছে।",
  "Brand updated successfully.": "ব্র্যান্ড সফলভাবে আপডেট হয়েছে।",
  "Brand deleted successfully.": "ব্র্যান্ড সফলভাবে মুছে ফেলা হয়েছে।",
  "Product created successfully.": "পণ্য সফলভাবে তৈরি হয়েছে।",
  "Product updated successfully.": "পণ্য সফলভাবে আপডেট হয়েছে।",
  "Product deleted successfully.": "পণ্য সফলভাবে মুছে ফেলা হয়েছে।",
  "Something went wrong": "কিছু ভুল হয়েছে",
  "Please fill all required fields.": "সব প্রয়োজনীয় ঘর পূরণ করুন।",
  "Update failed.": "আপডেট ব্যর্থ।",
  "Update failed": "আপডেট ব্যর্থ",
  "Save failed": "সংরক্ষণ ব্যর্থ",
  "Create failed": "তৈরি ব্যর্থ",
  "Delete failed": "মুছে ফেলা ব্যর্থ",
  "Failed": "ব্যর্থ",
  "Checkout failed": "চেকআউট ব্যর্থ",
  "Submit failed": "জমা দেওয়া ব্যর্থ",
  "Upload failed": "আপলোড ব্যর্থ",
  "Failed to send OTP": "OTP পাঠানো ব্যর্থ",
  "Signup failed": "সাইনআপ ব্যর্থ",
  "Invalid token.": "অবৈধ টোকেন।",
  "Access denied.": "প্রবেশাধিকার প্রত্যাখ্যান।",
  "Only admin can access this resource.": "শুধুমাত্র অ্যাডমিন এই রিসোর্স অ্যাক্সেস করতে পারে।",
  "Global Super Admin access required.": "গ্লোবাল সুপার অ্যাডমিন অ্যাক্সেস প্রয়োজন।",
  "Your account is {status}.": "আপনার অ্যাকাউন্ট {status}।",
};
function loadLocaleFile(code) {
  const file = path.join(__dirname, "locales", `${code}.json`);
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_) {
    return {};
  }
}

function buildCatalogs() {
  const out = { en: {} };
  for (const text of PRIORITY_EN) out.en[text] = text;
  out.bn = { ...BN, ...loadLocaleFile("bn") };
  for (const code of LOCALES) {
    if (code === "bn") continue;
    out[code] = loadLocaleFile(code);
  }
  return out;
}

const catalogs = buildCatalogs();
catalogs.PRIORITY_EN = PRIORITY_EN;
catalogs.LOCALES = LOCALES;
module.exports = catalogs;
