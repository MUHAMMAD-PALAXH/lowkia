const Branch = require('../model/branch');
const Employee = require('../model/employee');
const { companyFilter } = require('./tenantScope');
const { isCompanyEmployee } = require('./roleAccess');

/**
 * Employee / branch_manager → { defaultBranchId, branchIds } where branchIds is
 * the assigned branch plus branches they manage (Branch.managerIds / managerId).
 * Owners, or staff with no branch at all → null (no branch restriction).
 */
async function resolveStaffBranchScope(req) {
  if (!isCompanyEmployee(req.user?.role) || !req.user?._id) return null;
  const employee = await Employee.findOne({
    userId: req.user._id,
    isDeleted: { $ne: true }
  })
    .select('_id branchId')
    .lean();

  const managerMatch = [{ managerId: req.user._id }];
  if (employee?._id) managerMatch.push({ managerIds: employee._id });
  const managed = await Branch.find({
    ...companyFilter(req.companyId),
    isDeleted: { $ne: true },
    $or: managerMatch
  })
    .select('_id')
    .lean();

  const defaultBranchId = employee?.branchId ? String(employee.branchId) : null;
  const branchIds = [
    ...new Set([defaultBranchId, ...managed.map((b) => String(b._id))].filter(Boolean))
  ];
  if (!branchIds.length) return null;
  return { defaultBranchId: defaultBranchId || branchIds[0], branchIds };
}

module.exports = { resolveStaffBranchScope };
