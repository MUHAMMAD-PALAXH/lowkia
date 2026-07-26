const Role = require("../model/role");

const roles = [

    {
        name: "super_admin",
        displayName: "Super Admin",
        description: "System Owner",
        isSystem: true
    },

    {
        name: "admin",
        displayName: "Administrator",
        description: "System Administrator",
        isSystem: true
    },

    {
        name: "vendor",
        displayName: "Vendor",
        description: "Marketplace Vendor",
        isSystem: true
    },

    {
        name: "purchase_manager",
        displayName: "Purchase Manager",
        description: "Manage Purchase",
        isSystem: true
    },

    {
        name: "warehouse_manager",
        displayName: "Warehouse Manager",
        description: "Warehouse Controller",
        isSystem: true
    },

    {
        name: "sales_manager",
        displayName: "Sales Manager",
        description: "Sales Controller",
        isSystem: true
    },

    {
        name: "accounts_manager",
        displayName: "Accounts Manager",
        description: "Accounts Department",
        isSystem: true
    },

    {
        name: "branch_manager",
        displayName: "Branch Manager",
        description: "Branch Controller",
        isSystem: true
    },

    {
        name: "hr_manager",
        displayName: "HR Manager",
        description: "Human Resource",
        isSystem: true
    }

];

const seedRoles = async () => {

    for (const role of roles) {

        await Role.updateOne(

            {
                name: role.name
            },

            {
                $setOnInsert: role
            },

            {
                upsert: true
            }

        );

    }

    console.log("✅ Roles Seeded");

};

module.exports = seedRoles;