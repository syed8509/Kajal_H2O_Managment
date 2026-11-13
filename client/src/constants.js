export const PRODUCTS = ["250ml", "500ml", "1L", "2L", "20L"];
export const TYPES = ["Shop", "Hotel", "Home", "Office", "Bar", "event", "Other"];
export const METHODS = ["Cash", "UPI", "Bank Transfer", "Other"];
export const INVALID_MOBILE_MESSAGE = "Please enter a valid mobile number.";
export const isValidIndianMobile = (value) => /^[6-9][0-9]{9}$/.test(value);
export const normalizeIndianMobile = (value) =>
  String(value ?? "").trim().replace(/[\s().-]/g, "");
export const DUPLICATE_CUSTOMER_PHONE_MESSAGE =
  "An active customer already uses this phone number.";
export const blankCustomer = {
  name: "",
  phone: "",
  whatsappPhone: "",
  type: "Shop",
  address: "",
  notes: "",
};
