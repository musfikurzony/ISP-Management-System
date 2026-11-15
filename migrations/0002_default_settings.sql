-- Starting values for the Settings screen. All of these can be changed later
-- by an administrator inside the application.
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('isp_name', 'My ISP'),
  ('isp_logo', ''),
  ('isp_address', ''),
  ('isp_contact', ''),
  ('billing_day', '1'),
  ('due_days', '10'),
  ('auto_billing', '1'),
  ('auto_billing_last_period', ''),
  ('currency_symbol', '৳'),
  ('language', 'en'),
  ('invoice_prefix', 'INV-'),
  ('receipt_prefix', 'RCP-'),
  ('invoice_format', 'a4'),
  ('receipt_format', 'a5'),
  ('invoice_footer', 'Thank you for staying with us.'),
  ('expense_categories', 'Bandwidth,Salary,Office Rent,Electricity,Equipment,Maintenance,Transport,Other'),
  ('income_categories', 'Connection Fee,Equipment Sale,Reconnection Fee,Other');
