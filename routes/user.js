const express = require('express');
const asyncHandler = require('express-async-handler');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const router = express.Router();
const User = require('../model/user');
const otpGenerator = require('otp-generator');
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const otpStore = {};

const sendOTP = async (email, purpose) => {
  if (!email) throw new Error("Email is required");
  const otp = otpGenerator.generate(6, { digits: true, alphabets: false, upperCase: false, specialChars: false });
  otpStore[email.toLowerCase()] = { otp, purpose, expires: Date.now() + 10 * 60 * 1000 };
  const { data, error } = await resend.emails.send({
    from: 'Your App <onboarding@resend.dev>',
    to: [email],
    subject: `Your ${purpose} OTP`,
    text: `Your OTP: ${otp}. Valid for 10 minutes.`,
    html: `<strong>${otp}</strong><p>Valid for 10 minutes. Do not share.</p>`,
  });
  if (error) throw new Error(error.message);
  return data;
};

// REGISTER
router.post('/register', asyncHandler(async (req, res) => {
  const { firstName, lastName, email, password } = req.body;
  if (!firstName || !lastName || !email || !password) return res.status(400).json({ success: false, message: "All fields are required" });
  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) return res.status(400).json({ success: false, message: "Email already registered" });
  const user = new User({ firstName, lastName, email: email.toLowerCase(), password });
  await user.save();
  await sendOTP(email.toLowerCase(), 'Registration Verification');
  res.json({ success: true, message: "OTP sent for verification" });
}));

// VERIFY REGISTRATION
router.post('/verify-registration', asyncHandler(async (req, res) => {
  const { email, otp } = req.body;
  const stored = otpStore[email?.toLowerCase()];
  if (!stored || stored.otp !== otp) return res.status(400).json({ success: false, message: "Invalid or expired OTP" });
  const user = await User.findOneAndUpdate({ email: email.toLowerCase() }, { isVerified: true }, { new: true });
  delete otpStore[email.toLowerCase()];
  const token = jwt.sign({ id: user._id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
  res.json({ success: true, message: "Account verified successfully", token, data: user });
}));

// LOGIN
router.post('/login', asyncHandler(async (req, res) => {
  const login = req.body.login || '';
  const password = req.body.password || '';
  if (!login || !password) return res.status(400).json({ success: false, message: "Invalid credentials" });
  const user = await User.findOne({ email: login.toLowerCase() });
  if (!user || !(await user.comparePassword(password))) return res.status(401).json({ success: false, message: "Invalid credentials" });
  if (!user.isVerified) return res.status(401).json({ success: false, message: "Please verify your email first" });
  const token = jwt.sign({ id: user._id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
  res.json({ success: true, message: "Login successful", token, data: user });
}));

// GOOGLE AUTH
router.post('/auth/google', asyncHandler(async (req, res) => {
  const { idToken } = req.body;
  if (!idToken) return res.status(400).json({ success: false, message: "ID token is required" });
  const ticket = await googleClient.verifyIdToken({ idToken, audience: process.env.GOOGLE_CLIENT_ID });
  const payload = ticket.getPayload();
  const normalizedEmail = payload.email.toLowerCase();
  let user = await User.findOne({ googleId: payload.sub }) || await User.findOne({ email: normalizedEmail });
  if (!user) {
    user = new User({ googleId: payload.sub, firstName: payload.given_name, lastName: payload.family_name, email: normalizedEmail, isVerified: true });
    await user.save();
  }
  const token = jwt.sign({ id: user._id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
  res.json({ success: true, message: "Google auth successful", token, data: user });
}));

// FORGOT PASSWORD
router.post('/forgot-password', asyncHandler(async (req, res) => {
  const { email } = req.body;
  const user = await User.findOne({ email: email?.toLowerCase() });
  if (!user) return res.status(404).json({ success: false, message: "User not found" });
  await sendOTP(email.toLowerCase(), 'Password Reset');
  res.json({ success: true, message: "OTP sent for password reset" });
}));

// RESET PASSWORD
router.post('/reset-password', asyncHandler(async (req, res) => {
  const { email, otp, newPassword } = req.body;
  const stored = otpStore[email?.toLowerCase()];
  if (!stored || stored.otp !== otp) return res.status(400).json({ success: false, message: "Invalid or expired OTP" });
  const user = await User.findOne({ email: email.toLowerCase() });
  user.password = newPassword;
  await user.save();
  delete otpStore[email.toLowerCase()];
  res.json({ success: true, message: "Password reset successful" });
}));

// PROFILE UPDATE
router.post('/send-profile-update-otp', asyncHandler(async (req, res) => {
  const { email } = req.body;
  await sendOTP(email.toLowerCase(), 'Profile Update Verification');
  res.json({ success: true, message: "OTP sent" });
}));

router.post('/verify-profile-update', asyncHandler(async (req, res) => {
  const { email, otp, firstName, lastName, password } = req.body;
  const stored = otpStore[email?.toLowerCase()];
  if (!stored || stored.otp !== otp) return res.status(400).json({ success: false, message: "Invalid OTP" });
  const user = await User.findOne({ email: email.toLowerCase() });
  user.firstName = firstName; user.lastName = lastName;
  if (password) user.password = password;
  await user.save();
  delete otpStore[email.toLowerCase()];
  res.json({ success: true, message: "Profile updated successfully", data: user });
}));

module.exports = router;