const Settings = require("../model/settings");
const AppError = require("../utils/appError");
const { companyFilter, stampCompany } = require("../utils/tenantScope");

const DEFAULT_TIMEZONE = "Asia/Dhaka";

const getGlobalSettings = async (companyId = null) => {
    const tenant = companyFilter(companyId);
    let settings = await Settings.findOne({ key: "global", ...tenant });
    if (!settings) {
        settings = await Settings.create(
            stampCompany(
                {
                    key: "global",
                    timezone: DEFAULT_TIMEZONE
                },
                companyId
            )
        );
    }
    if (!settings.timezone) {
        settings.timezone = DEFAULT_TIMEZONE;
        await settings.save();
    }
    return settings;
};

const getTimezone = async (companyId = null) => {
    const settings = await getGlobalSettings(companyId);
    return settings.timezone || DEFAULT_TIMEZONE;
};

const updateGlobalSettings = async (payload = {}, companyId = null) => {
    const settings = await getGlobalSettings(companyId);

    if (payload.timezone !== undefined) {
        const tz = String(payload.timezone || "").trim();
        if (!tz) {
            throw new AppError("Timezone is required.", 400);
        }
        try {
            Intl.DateTimeFormat("en-US", { timeZone: tz });
        } catch (_) {
            throw new AppError(`Invalid timezone: ${tz}`, 400);
        }
        settings.timezone = tz;
    }

    if (payload.defaultAttendancePolicyId !== undefined) {
        settings.defaultAttendancePolicyId =
            payload.defaultAttendancePolicyId || null;
    }

    if (payload.salesTargets && typeof payload.salesTargets === "object") {
        const t = payload.salesTargets;
        if (t.daily !== undefined) settings.salesTargets.daily = Number(t.daily);
        if (t.weekly !== undefined) {
            settings.salesTargets.weekly = Number(t.weekly);
        }
        if (t.monthly !== undefined) {
            settings.salesTargets.monthly = Number(t.monthly);
        }
        if (t.yearly !== undefined) {
            settings.salesTargets.yearly = Number(t.yearly);
        }
    }

    settings.updatedAt = new Date();
    await settings.save();
    return settings;
};

module.exports = {
    DEFAULT_TIMEZONE,
    getGlobalSettings,
    getTimezone,
    updateGlobalSettings
};
