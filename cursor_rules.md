# ==========================================================
# LOWKIA ERP - CURSOR RULES
# Version: 1.0
# Author: Muhammad Palash
# Architecture: Enterprise ERP (Odoo Inspired)
# Backend: Node.js + Express.js + MongoDB 
# Frontend: Flutter Admin App + Flutter User App
# Database: MongoDB Atlas
# Deployment: Render
# Authentication: JWT
# Validation: express-validator
# Services: Cloudinary + Resend
# Language: JavaScript
# ==========================================================

# PROJECT OVERVIEW

This project is an Enterprise Grade ERP System for Phone Fix Accessories.

The goal is NOT to build a simple inventory software.

The goal is to build a scalable ERP similar to Odoo ERP while following
Node.js best practices.

The project will be developed Phase by Phase.

Never jump to future phases unless explicitly instructed.

Backend development always comes before Flutter development.

Current Development Phase:
Phase 1

Future phases:
- Sales
- Customer
- Warranty
- Repair
- HR
- CRM
- Accounts
- Reports
- Analytics
- Multi Company

--------------------------------------------------------

# GOLDEN RULE

Never assume.

If anything is unclear,
STOP
and ask the owner.

Never guess.

--------------------------------------------------------

# PROJECT GOAL

Write production-ready code.

Write maintainable code.

Write scalable code.

Write reusable code.

Write secure code.

Write enterprise quality code.

Never write shortcut code.

Never create technical debt.

--------------------------------------------------------

# DEVELOPMENT STYLE

Always think like

Senior Software Engineer

+

Senior ERP Architect

+

Senior Code Reviewer

Not like an AI code generator.

--------------------------------------------------------

# CURRENT DEVELOPMENT PHASE

Current Company Mode

Single Company

Future

Multi Company

The architecture MUST support future Multi Company
without database redesign.

--------------------------------------------------------

# PHASE DEVELOPMENT

Only work on the current phase.

Do NOT implement future modules.

Do NOT create unnecessary files.

Do NOT over engineer.

--------------------------------------------------------

# CURRENT PHASE MODULES

Authentication Review

Branch

Warehouse

Supplier

Purchase Order

Purchase Approval

GRN

Inventory

IMEI

Barcode

Warehouse Transfer

Purchase Price History

Product

Stock Movement

--------------------------------------------------------

# PROJECT STRUCTURE

Server Folder

controllers/

middlewares/

models/

routes/

services/

validators/

utils/

config/

helpers/

uploads/

logs/

constants/

--------------------------------------------------------

Never change folder structure
without owner permission.

--------------------------------------------------------

Never rename folders.

Never move files.

Never create duplicate folders.

--------------------------------------------------------

# CODING STANDARD

Use JavaScript only.

Use async/await.

Never use callbacks.

Never use nested promises.

Always use try/catch.

Never swallow errors.

--------------------------------------------------------

# EXPRESS RULES

Controllers

Only request handling.

No business logic.

--------------------------------------------------------

Business logic

Always goes into Services.

--------------------------------------------------------

Database access

Never directly inside Routes.

--------------------------------------------------------

Routes

Only routing.

Nothing else.

--------------------------------------------------------

Validation

Use express-validator.

Every API must validate input.

Never trust request body.

--------------------------------------------------------

# DATABASE

MongoDB

Mongoose

Camel Case fields

Readable Business IDs

Mongo ObjectId

Both must exist.

Example

Product

ObjectId

Business ID

PRD-000001

Warehouse

WH-000001

Supplier

SUP-000001

Purchase Order

PO-000001

Branch

BRN-000001

Employee

EMP-000001

GRN

GRN-000001

--------------------------------------------------------

Business IDs

Never editable.

Never reused.

Never regenerated.

--------------------------------------------------------

# NAMING

Collections

Plural

Models

Singular

Variables

camelCase

Functions

camelCase

Constants

UPPER_CASE

--------------------------------------------------------

# COMMENTS

Write meaningful comments only.

Never write useless comments.

Bad

// increment stock

Good

// Increase warehouse stock after successful GRN completion

--------------------------------------------------------

# FILE SIZE

Controllers

Maximum 300 lines

Services

Maximum 500 lines

Split if necessary.

--------------------------------------------------------

# DUPLICATE CODE

Never duplicate logic.

Always reuse services.

--------------------------------------------------------

# CLEAN CODE

Follow SOLID principles.

Follow DRY.

Follow KISS.

Follow Separation of Concerns.

--------------------------------------------------------

# ERROR HANDLING

Global Error Middleware.

Never return raw errors.

Always return API response format.

--------------------------------------------------------

# API RESPONSE

Always

{
    success: true,
    message: "",
    data: {},
    errors: null
}

Errors

{
    success: false,
    message: "",
    data: null,
    errors: {}
}

Never return inconsistent responses.

--------------------------------------------------------

# SECURITY

Never expose

password

token

secret

apiKey

Never log passwords.

Never log JWT.

--------------------------------------------------------

# AUTHENTICATION

JWT

Access Token

Refresh Token

Remember Me

Logout All Devices

Role

Owner

Employee

--------------------------------------------------------

Managers

Warehouse Manager

Branch Manager

Inventory Manager

Purchase Manager

All are Employees with permissions.

Never create separate role.

--------------------------------------------------------

# IMPORTANT

Always inspect existing code first.

Never rewrite completed modules.

Always extend existing implementation.

Backward compatibility is mandatory.

Never break working APIs.

If breaking change is required,

STOP

Explain

Take permission

Then implement.

--------------------------------------------------------

# ==========================================================
# INVENTORY ARCHITECTURE
# ==========================================================

Inventory is the heart of this ERP.

Never update stock directly from any controller.

Stock can ONLY be modified through Inventory Service.

Never bypass Inventory Service.

Every stock change must create:

- Stock Movement
- Audit Log
- Activity History

----------------------------------------------------------

# PRODUCT ARCHITECTURE

Product is a MASTER entity.

Product never belongs to a Branch.

Product never belongs to a Warehouse.

Products exist globally.

Stock belongs to Warehouses.

Branches consume stock from assigned Warehouses.

----------------------------------------------------------

Correct Structure

Product

↓

Warehouse Stock

↓

Branch

↓

Sale

Never create duplicate products for different branches.

----------------------------------------------------------

# PRODUCT CODE

Every Product must have:

Mongo ObjectId

Business Product Code

Example

PRD-000001

PRD-000002

Product Codes

Never editable

Never reused

Never regenerated

----------------------------------------------------------

# PRODUCT IMAGES

Maximum Images

5

Cloudinary only.

Never store image files inside server.

Store only Cloudinary URLs.

----------------------------------------------------------

# PRODUCT TYPES

Two Product Categories

IMEI Product

Non IMEI Product

----------------------------------------------------------

IMEI Products

Examples

Phones

Tablet

Smart Watch

Laptop

----------------------------------------------------------

Non IMEI Products

Cable

Cover

Charger

Headphone

Adapter

Mouse

Keyboard

Etc.

----------------------------------------------------------

# IMEI RULES

IMEI must be globally unique.

Duplicate IMEI

Reject immediately.

Never allow duplicate IMEI.

IMEI Status

Received

In Warehouse

Transferred

Allocated

Sold

Returned

Repair

Replaced

Inactive

Maintain complete IMEI lifecycle.

----------------------------------------------------------

Warranty starts ONLY after Sale.

Never after Purchase.

Never after GRN.

----------------------------------------------------------

# BARCODE RULES

Only Non IMEI products require barcode.

Barcode generated automatically.

Barcode never changes.

Barcode must uniquely identify Product.

Do not generate a barcode for every quantity.

Generate ONE barcode per Product.

----------------------------------------------------------

# BRANCH

Branch is NOT a warehouse.

Branch uses Warehouse.

One Warehouse

↓

Multiple Branches

Allowed.

One Branch

↓

One Warehouse

Only one active warehouse at a time.

----------------------------------------------------------

Changing Warehouse Assignment

Must create Audit Log.

----------------------------------------------------------

# WAREHOUSE

Warehouse stores stock.

Warehouse owns inventory.

Warehouse receives products.

Warehouse transfers products.

Warehouse never sells directly.

Sales happen from Branch.

----------------------------------------------------------

Warehouse Types

Main Warehouse

Branch Warehouse

Return Warehouse

Damage Warehouse

----------------------------------------------------------

# SUPPLIER

Supplier is NOT a user.

Supplier has NO login.

Supplier exists as database entity only.

Supplier may supply many Products.

One Product

↓

Many Suppliers

Allowed.

Maintain Purchase Price History.

----------------------------------------------------------

# PURCHASE ORDER

Purchase Order can be created by

Owner

Employee

----------------------------------------------------------

Owner Purchase Order

Automatically Approved.

----------------------------------------------------------

Employee Purchase Order

Approval Required.

Owner approval mandatory.

----------------------------------------------------------

Purchase Order Status

Draft

↓

Pending Approval

↓

Approved

↓

Supplier Accepted

↓

Partially Received

↓

Completed

↓

Cancelled

Never skip status transitions.

----------------------------------------------------------

Purchase Order Types

New Product Purchase

Existing Product Purchase

----------------------------------------------------------

Existing Product Purchase

Show Current Stock

Show Assigned Suppliers

Show Purchase History

----------------------------------------------------------

# GRN

Goods Receive Note

Automatically generated

after Supplier delivers Products.

Manual GRN creation

Not allowed.

----------------------------------------------------------

Stock increases ONLY after

GRN Completion.

Never increase stock

during Purchase Order creation.

----------------------------------------------------------

# RECEIVING PRODUCTS

IMEI Product

Warehouse scans IMEI one by one.

Each successful scan

creates Inventory record.

Invalid IMEI

Reject.

Duplicate IMEI

Reject.

----------------------------------------------------------

Non IMEI Product

Warehouse enters received quantity.

System updates stock.

Auto creates Stock Movement.

----------------------------------------------------------

# STOCK RULES

Stock

Never negative.

Never manually edited.

Never updated directly.

Always use Inventory Service.

----------------------------------------------------------

Stock Increase

GRN Complete

Stock Decrease

Sale

Warehouse Transfer

Damage

Adjustment (Owner only)

----------------------------------------------------------

# STOCK MOVEMENT

Every stock movement must record

Movement ID

Product

Warehouse

Branch

Quantity

Previous Stock

Current Stock

Movement Type

Reference Type

Reference ID

Created By

Created At

Reason

----------------------------------------------------------

Movement Types

Purchase

Sale

Transfer

Return

Damage

Adjustment

Repair

Replacement

----------------------------------------------------------

# PURCHASE PRICE HISTORY

Every purchase stores

Supplier

Purchase Price

Date

Purchase Order

Warehouse

Quantity

Never overwrite old purchase prices.

Always preserve history.

----------------------------------------------------------

# WAREHOUSE TRANSFER

Warehouse Transfer

Must use transaction.

Source Warehouse

Destination Warehouse

Quantity Validation

Stock Validation

Audit Log

Stock Movement

Activity History

Required.

----------------------------------------------------------

Transfer should fail

if stock is insufficient.

----------------------------------------------------------

# AUDIT LOG

Required for

Product Create

Product Update

Branch Update

Warehouse Update

Supplier Update

Purchase Order

GRN

Transfer

Inventory Update

IMEI Scan

Sale

Warranty

Return

Repair

Delete

----------------------------------------------------------

# ACTIVITY HISTORY

Every document stores

Created By

Updated By

Updated At

Deleted By

Deleted At

Reason

where applicable.

----------------------------------------------------------

# ==========================================================
# API DEVELOPMENT RULES
# ==========================================================

Every API must follow REST principles.

Use proper HTTP methods.

GET
POST
PUT
PATCH
DELETE

Never misuse HTTP methods.

----------------------------------------------------------

Every API must use express-validator.

Validation is mandatory.

Never trust request body.

Never trust request params.

Never trust request query.

----------------------------------------------------------

Always sanitize user input.

Reject invalid requests.

Return proper validation errors.

----------------------------------------------------------

# RESPONSE FORMAT

Every API response MUST follow this format.

Success

{
    "success": true,
    "message": "",
    "data": {},
    "errors": null
}

Failure

{
    "success": false,
    "message": "",
    "data": null,
    "errors": {}
}

Never create custom response formats.

----------------------------------------------------------

# ERROR HANDLING

Never use try/catch inconsistently.

All errors must reach Global Error Middleware.

Never expose stack trace.

Never expose database errors.

Never expose internal implementation.

----------------------------------------------------------

# DATABASE TRANSACTIONS

MongoDB Transactions are mandatory for:

Purchase

GRN

Warehouse Transfer

Inventory Update

Sale

Return

Repair

Stock Adjustment

Whenever multiple collections are modified.

----------------------------------------------------------

# AUTHENTICATION

JWT Access Token

JWT Refresh Token

Remember Me

Logout Current Device

Logout All Devices

Refresh Token Rotation

----------------------------------------------------------

# AUTHORIZATION

Only two roles exist.

Owner

Employee

Never create extra roles.

Managers are Employees with permissions.

----------------------------------------------------------

Permissions must control:

Inventory

Purchase

Sales

Reports

Warehouse

Branch

Products

Users

Settings

Repair

Warranty

----------------------------------------------------------

# SECURITY

Never hardcode secrets.

Never hardcode passwords.

Never expose JWT.

Never expose API keys.

Read all secrets from environment variables.

----------------------------------------------------------

Hash passwords using bcrypt.

Never store plain text passwords.

----------------------------------------------------------

# CLOUDINARY

Images must be uploaded to Cloudinary.

Only Cloudinary URLs are stored.

If an image is replaced, remove the old Cloudinary asset.

----------------------------------------------------------

# LOGGING

Create audit log for every important action.

Do not log passwords.

Do not log tokens.

Do not log secrets.

----------------------------------------------------------

# PERFORMANCE

Use pagination for all large lists.

Use indexes for searchable fields.

Avoid unnecessary database queries.

Select only required fields.

Never fetch unnecessary data.

----------------------------------------------------------

# SOFT DELETE

Soft Delete is default.

Hard Delete only with Owner permission.

Never hard delete transactional data.

----------------------------------------------------------

# BREAKING CHANGES POLICY

Never rename:

Routes

Controllers

Database fields

Collections

Models

Folders

Business IDs

Without Owner approval.

----------------------------------------------------------

If breaking change is required:

STOP.

Explain the reason.

Explain the impact.

List affected files.

Wait for Owner approval.

Only then implement.

----------------------------------------------------------

# EXISTING CODE POLICY

Always inspect existing code first.

Prefer extending existing modules.

Never rewrite completed modules.

Never duplicate business logic.

----------------------------------------------------------

# CURSOR BEHAVIOUR

Before writing code:

1. Read related models.
2. Read related services.
3. Read related routes.
4. Understand existing architecture.
5. Reuse existing code whenever possible.

----------------------------------------------------------

Never assume missing logic.

Ask if unsure.

----------------------------------------------------------

After every task provide:

Summary

Files Changed

Reason for each change

Impact Analysis

Testing Steps

Future TODO (if any)

----------------------------------------------------------

# FLUTTER PROTECTION

Current focus:

Backend only.

Do NOT modify Flutter Admin App.

Do NOT modify Flutter User App.

Only touch Flutter when Owner explicitly requests it.

----------------------------------------------------------

# GIT WORKFLOW

Never recommend force changes.

Every phase should be committed separately.

Example:

Phase 1 - Branch

Phase 1 - Warehouse

Phase 1 - Purchase

Phase 1 - GRN

Phase 1 - Inventory

----------------------------------------------------------

# FILE MODIFICATION RULES

Modify only necessary files.

Never create duplicate models.

Never create duplicate services.

Never create duplicate routes.

----------------------------------------------------------

# DOCUMENTATION

Every new module must include:

Purpose

Workflow

Dependencies

Future extension notes

----------------------------------------------------------

# CODE QUALITY CHECKLIST

Before completing any task verify:

✓ No duplicate logic

✓ Validation added

✓ Proper error handling

✓ Transaction used (if required)

✓ Audit log created

✓ Activity history updated

✓ Response format correct

✓ Existing APIs preserved

✓ Existing functionality not broken

✓ Clean code

----------------------------------------------------------

# ==========================================================
# LOWKIA ERP - DEVELOPMENT CONSTITUTION
# Part 4
# ==========================================================

# PROJECT VISION

The objective of this ERP is NOT to build a simple inventory software.

The objective is to build a Production Ready,
Enterprise Grade ERP inspired by Odoo architecture,
optimized for Mobile, Accessories, Service,
Repair, Warranty and Inventory Management.

This project should remain scalable for the next
5+ years without major architecture redesign.

----------------------------------------------------------

# DEVELOPMENT PHILOSOPHY

Always choose

Maintainability

over

Speed.

Always choose

Scalability

over

Shortcut.

Always choose

Readability

over

Complex Code.

----------------------------------------------------------

# DEVELOPMENT WORKFLOW

Every feature must follow this sequence.

1.
Understand existing implementation.

↓

2.
Analyze dependencies.

↓

3.
Discuss architecture if breaking changes are required.

↓

4.
Implement backend.

↓

5.
Validate APIs.

↓

6.
Test business flow.

↓

7.
Review code.

↓

8.
Generate implementation summary.

↓

9.
Mark phase completed.

Never skip this workflow.

----------------------------------------------------------

# PHASE IMPLEMENTATION

Only one phase at a time.

Never work on multiple major phases together.

Current Priority

Phase 1

Branch

Warehouse

Supplier

Purchase

GRN

Inventory

IMEI

Barcode

Warehouse Transfer

Product

Purchase Price History

Only after Phase 1 is stable,
continue to Phase 2.

----------------------------------------------------------

# PHASE COMPLETION CHECKLIST

A phase is considered COMPLETE only if:

✓ APIs work

✓ Validation added

✓ Error handling completed

✓ Audit Logs implemented

✓ Activity History implemented

✓ Transactions verified

✓ No duplicate logic

✓ No lint errors

✓ Existing modules still work

✓ Business flow tested

✓ Documentation updated

----------------------------------------------------------

# TESTING POLICY

Before marking any feature complete,
verify at least the following:

Create

Read

Update

Delete

Permissions

Validation

Duplicate prevention

Edge cases

Invalid requests

Stock updates

Audit logs

Activity history

Transaction rollback

----------------------------------------------------------

# BEFORE MODIFYING ANY FILE

Cursor MUST answer internally:

Why is this file changing?

Which modules depend on it?

Will Flutter be affected?

Will existing APIs break?

Can this be extended instead of rewritten?

If unsure,
STOP
and ask the Owner.

----------------------------------------------------------

# AFTER EVERY TASK

Always provide:

1. Summary

2. Files Modified

3. Why each file changed

4. Database impact

5. API impact

6. Flutter impact

7. Manual testing steps

8. Future improvements (optional)

----------------------------------------------------------

# FORBIDDEN ACTIONS

Never:

Rename existing API routes.

Rename database fields.

Rename collections.

Rename folders.

Delete models.

Delete services.

Delete routes.

Rewrite completed modules.

Change business workflow.

Create duplicate logic.

Introduce breaking changes.

Modify Flutter folders during backend phases.

Change folder structure without approval.

Change database architecture without approval.

----------------------------------------------------------

# REQUIRED ACTIONS

Always:

Reuse existing code.

Use transactions when required.

Validate input.

Return consistent responses.

Create audit logs.

Create activity history.

Use services for business logic.

Use clean naming.

Write maintainable code.

Think about future multi-company support.

----------------------------------------------------------

# MULTI-COMPANY PREPARATION

Current implementation:

Single Company.

Future implementation:

Multi Company.

While implementing current features:

Never hardcode company assumptions.

Keep architecture extendable.

Avoid database redesign requirements.

----------------------------------------------------------

# FUTURE MODULE ROADMAP

Phase 2

Sales

Customer

Invoice

Warranty

Returns

Exchange

----------------------------------------------------------

Phase 3

Repair

Service Center

Technician

Repair Ticket

----------------------------------------------------------

Phase 4

Reports

Analytics

Dashboard

----------------------------------------------------------

Phase 5

HR

Attendance

Payroll

Leave

----------------------------------------------------------

Phase 6

Accounts

Expense

Income

Ledger

Profit & Loss

----------------------------------------------------------

Phase 7

CRM

Notification

Settings

Backup

----------------------------------------------------------

Phase 8

Multi Company

----------------------------------------------------------

# MASTER PROMPT FOR CURSOR

Before starting any task:

Read this cursor_rules.md completely.

Understand current phase.

Inspect existing implementation.

Do not rewrite completed modules.

Preserve backward compatibility.

Implement only what has been requested.

If architecture changes are required,
explain them first and wait for approval.

After implementation,
provide:

Summary

Changed Files

Impact Analysis

Testing Guide

Future Recommendations

----------------------------------------------------------

# FINAL RULE

This ERP must always be developed like
an Enterprise Software Product,
not like a tutorial project.

Every decision should prioritize:

Scalability

Maintainability

Security

Performance

Consistency

Future Expansion

Code Quality

Business Logic Accuracy

If there are multiple implementation options,
always choose the one that best fits
enterprise ERP architecture.

==========================================================
END OF cursor_rules.md
==========================================================