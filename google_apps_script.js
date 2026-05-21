/**
 * Leave Management System - Google Apps Script Backend
 * -------------------------------------------------------------
 * โค้ดนี้สำหรับนำไปวางใน Google Apps Script (ส่วนขยาย > Apps Script) ของ Google Sheets
 * เพื่อทำหน้าที่เป็น Web App API ในการรับข้อมูลจากแอปพลิเคชันหน้าเว็บ
 */

// กำหนดชื่อชีตที่ต้องการบันทึกข้อมูล (หากไม่มี ระบบจะสร้างขึ้นใหม่)
var SHEET_NAME = "รายการลาทั้งหมด";

/**
 * ฟังก์ชัน doGet สำหรับทดสอบการเชื่อมต่อ (Test Connection)
 * เมื่อมีการส่งคำขอแบบ GET เข้ามา จะคืนค่าสถานะตอบกลับทันที
 */
function doGet(e) {
  var response = {
    status: "success",
    message: "เชื่อมต่อกับ Google Sheets สำเร็จแล้ว! พร้อมใช้งานระบบบันทึกข้อมูลการลา",
    timestamp: new Date().toISOString()
  };
  
  return ContentService.createTextOutput(JSON.stringify(response))
    .setMimeType(ContentService.MimeType.JSON)
    .setHeader("Access-Control-Allow-Origin", "*");
}

/**
 * ฟังก์ชัน doPost สำหรับรับบันทึกข้อมูลการลา
 * รองรับการรับข้อมูลทั้งแบบแถวเดียว (Object) และหลายแถวพร้อมกัน (Array)
 */
function doPost(e) {
  try {
    // 1. ดึงข้อมูล JSON จาก Request Body
    var postData = e.postData.contents;
    var data = JSON.parse(postData);
    
    // 2. เรียกเปิด Google Sheet
    var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = spreadsheet.getSheetByName(SHEET_NAME);
    
    // หากยังไม่มีชีตชื่อนี้ ให้ทำการสร้างใหม่
    if (!sheet) {
      sheet = spreadsheet.insertSheet(SHEET_NAME);
    }
    
    // 3. ตรวจสอบและสร้างหัวตาราง (Headers) หากเป็นชีตเปล่า
    if (sheet.getLastRow() === 0) {
      var headers = ["วันเวลาที่บันทึก", "ชื่อผู้ลา", "วันที่ลา", "ประเภทการลา", "เหตุผลการลา", "แหล่งที่มา"];
      sheet.appendRow(headers);
      
      // จัดรูปแบบหัวตารางให้สวยงาม (ตัวหนา, พื้นหลังสีม่วงเข้ม, ตัวอักษรสีขาว)
      var headerRange = sheet.getRange(1, 1, 1, headers.length);
      headerRange.setFontWeight("bold");
      headerRange.setBackground("#4A154B");
      headerRange.setFontColor("#FFFFFF");
      headerRange.setHorizontalAlignment("center");
      sheet.setFrozenRows(1); // ตรึงแถวแรกไว้
    }
    
    // 4. บันทึกข้อมูลลงชีต
    var timestamp = new Date();
    
    // ตรวจสอบว่าเป็นข้อมูลอาร์เรย์ (กรณีส่งมาหลายวันพร้อมกัน) หรือแถวเดียว
    if (Array.isArray(data)) {
      // วนลูปบันทึกทีละแถว
      for (var i = 0; i < data.length; i++) {
        var row = data[i];
        sheet.appendRow([
          timestamp,
          row.name,
          formatDate(row.date),
          row.type,
          row.reason || "-",
          row.source || "Web Form"
        ]);
      }
    } else {
      // บันทึกแถวเดียว
      sheet.appendRow([
        timestamp,
        data.name,
        formatDate(data.date),
        data.type,
        data.reason || "-",
        data.source || "Web Form"
      ]);
    }
    
    // ปรับความกว้างคอลัมน์อัตโนมัติเพื่อให้ข้อมูลอ่านง่าย
    sheet.autoResizeColumns(1, 6);
    
    // 5. ส่งผลลัพธ์กลับไปยังแอปหน้าเว็บ
    var response = {
      status: "success",
      message: "บันทึกข้อมูลลง Google Sheet เรียบร้อยแล้ว!"
    };
    
    return ContentService.createTextOutput(JSON.stringify(response))
      .setMimeType(ContentService.MimeType.JSON)
      .setHeader("Access-Control-Allow-Origin", "*");
      
  } catch (error) {
    var response = {
      status: "error",
      message: "เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์: " + error.toString()
    };
    
    return ContentService.createTextOutput(JSON.stringify(response))
      .setMimeType(ContentService.MimeType.JSON)
      .setHeader("Access-Control-Allow-Origin", "*");
  }
}

/**
 * ฟังก์ชันเสริมจัดรูปแบบวันที่ให้อ่านง่ายขึ้นใน Google Sheet (เช่น YYYY-MM-DD)
 */
function formatDate(dateStr) {
  try {
    var d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    
    var year = d.getFullYear();
    var month = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return year + "-" + month + "-" + day;
  } catch(e) {
    return dateStr;
  }
}
