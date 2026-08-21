require("dotenv").config();

const AdminUser = require("../model/adminUser");
const { ROLES } = require("../constants/roles");

/**
 * Seed platform Global Super Admin (companyId = null).
 *
 * Env:
 *   GLOBAL_SUPER_ADMIN_EMAIL    (required)
 *   GLOBAL_SUPER_ADMIN_PASSWORD (required)
 *   GLOBAL_SUPER_ADMIN_FIRST_NAME (optional, default Platform)
 *   GLOBAL_SUPER_ADMIN_LAST_NAME  (optional, default Owner)
 */
const seedGlobalSuperAdmin = async () => {
    const email = String(process.env.GLOBAL_SUPER_ADMIN_EMAIL || "")
        .toLowerCase()
        .trim();
    const password = String(process.env.GLOBAL_SUPER_ADMIN_PASSWORD || "");

    if (!email || !password) {
        console.warn(
            "⚠️  Skip Global Super Admin seed: set GLOBAL_SUPER_ADMIN_EMAIL and GLOBAL_SUPER_ADMIN_PASSWORD"
        );
        return null;
    }

    if (password.length < 8) {
        throw new Error(
            "GLOBAL_SUPER_ADMIN_PASSWORD must be at least 8 characters"
        );
    }

    const firstName =
        String(process.env.GLOBAL_SUPER_ADMIN_FIRST_NAME || "Platform").trim() ||
        "Platform";
    const lastName =
        String(process.env.GLOBAL_SUPER_ADMIN_LAST_NAME || "Owner").trim() ||
        "Owner";

    let user = await AdminUser.findOne({ email });

    if (user) {
        let changed = false;
        if (user.role !== ROLES.GLOBAL_SUPER_ADMIN) {
            user.role = ROLES.GLOBAL_SUPER_ADMIN;
            changed = true;
        }
        if (user.companyId) {
            user.companyId = null;
            changed = true;
        }
        if (!user.isVerified) {
            user.isVerified = true;
            changed = true;
        }
        if (!user.isPhoneVerified) {
            user.isPhoneVerified = true;
            changed = true;
        }
        if (!user.isApproved) {
            user.isApproved = true;
            changed = true;
        }
        if (user.status !== "Active") {
            user.status = "Active";
            changed = true;
        }
        if (changed) {
            await user.save();
            console.log(`✅ Global Super Admin updated: ${email}`);
        } else {
            console.log(`ℹ️  Global Super Admin already present: ${email}`);
        }
        return user;
    }

    user = await AdminUser.create({
        firstName,
        lastName,
        email,
        phone: "",
        password,
        role: ROLES.GLOBAL_SUPER_ADMIN,
        companyId: null,
        isVerified: true,
        isPhoneVerified: true,
        isApproved: true,
        status: "Active",
    });

    console.log(`✅ Global Super Admin created: ${email}`);
    return user;
};

module.exports = seedGlobalSuperAdmin;
