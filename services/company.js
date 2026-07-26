const mongoose = require("mongoose");

const Company = require("../model/company");
const Branch = require("../model/branch");
const Warehouse = require("../model/warehouse");
const AdminUser = require("../model/adminUser");

const counterService = require("./counter.service");

class CompanyService {

    async createCompany(data, ownerId) {

    }

}

module.exports = new CompanyService();