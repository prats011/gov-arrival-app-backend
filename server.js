import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";
import bodyParser from "body-parser";
import cookieParser from "cookie-parser";
import { z } from "zod";
import PDFDocument from "pdfkit";
import fs from "fs";
import QRCode from "qrcode";
import { v4 as uuidv4 } from "uuid";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 5001;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const formatDate = (dateString) => {
  if (!dateString) return "-";
  const date = new Date(dateString);
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${year}/${month}/${day}`;
};

app.use(
  cors({
    origin: "*", // or specify: ['http://localhost:5173']
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

const personalInfoSchema = z.object({
  family_name: z.string().min(1),
  first_name: z.string().min(1),
  middle_name: z.string().optional(),
  passport_no: z.string().min(1),
  selected_nationality: z.string(),
  occupation: z.string(),
  gender: z.string(),
  visa_no: z.string().optional(),
  selected_country: z.string(),
  selected_city: z.string(),
  phone_no_code: z.string(),
  phone_no: z.string(),
  date_of_birth: z.string(),
});

const tripAccommodationSchema = z.object({
  date_of_arrival: z.string(),
  country_boarded: z.string(),
  purpose_of_travel: z.string(),
  purpose_of_travel_other: z.string().nullable().optional(),
  mode_of_travel_arrival: z.string(),
  mode_of_transport_arrival: z.string(),
  mode_of_transport_arrival_other: z.string().nullable().optional(),
  flight_vehicle_no_arrival: z.string(),
  date_of_departure: z.string().nullable().optional(),
  mode_of_travel_departure: z.string().nullable().optional(),
  mode_of_transport_departure: z.string().nullable().optional(),
  mode_of_transport_departure_other: z.string().nullable().optional(),
  flight_vehicle_no_departure: z.string().nullable().optional(),
  type_of_accommodation: z.string(),
  type_other: z.string().nullable().optional(),
  province: z.string(),
  district_area: z.string(),
  sub_district: z.string(),
  post_code: z.string(),
  address: z.string(),
});

const healthSchema = z.object({
  countries_visited: z
    .array(z.string())
    .min(1, "Please select at least one country"),
});

app.post("/api/create", async (req, res) => {
  const { personalInfo, tripInfo, health } = req.body;
  console.log(req.body);

  try {
    //1. VALIDATE both data, personal, health and last section
    const validationPI = personalInfoSchema.safeParse(personalInfo);
    const validationTR = tripAccommodationSchema.safeParse(tripInfo);
    const validationH = healthSchema.safeParse(health);

    if (
      !validationPI.success ||
      !validationTR.success ||
      !validationH.success
    ) {
      const errors = {
        personalInfo: validationPI.error?.flatten().fieldErrors || {},
        tripInfo: validationTR.error?.flatten().fieldErrors || {},
        health: validationH.error?.flatten().fieldErrors || {},
      };
      return res.status(400).json({ success: false, errors });
    }
    //2. insert personal info and health declaration
    const { data: profileData, error: profileError } = await supabase
      .from("profiles")
      .insert([validationPI.data])
      .select();

    if (profileError) throw profileError;

    const travelData = {
      ...validationTR.data,
      countries_visited: health.countries_visited,
    };

    const { data: trData, error: trError } = await supabase
      .from("travel_information")
      .insert([travelData])
      .select();

    if (trError) throw trError;

    //3. Create a qr code data and pdf qrcode data is random new uuidv4
    const uniqueId = uuidv4();

    const publicUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/pdfs/${uniqueId}.pdf`;

    const updateUrl =
      "https://tdac.immigration.go.th/arrival-card/#/tac/arrival-card/update/search";

    const doc = new PDFDocument({ margin: 30, font: "Times-Roman" });
    const filePath = `./pdfs/${uniqueId}.pdf`;
    fs.mkdirSync("./pdfs", { recursive: true });

    const writeStream = fs.createWriteStream(filePath);
    doc.pipe(writeStream);

    const personalData = validationPI.data;
    const tripData = validationTR.data;

    // Title
    doc.image("./public/govLogo.jpg", (doc.page.width - 200) / 2, 15, {
      fit: [200, 200],
    });
    doc.moveDown(10);

    // Introductory text
    doc
      .fontSize(10)
      .text(
        "Thank you for using the Thailand Digital Arrival Card. " +
          "This Thailand Digital Arrival Card is only valid for one time use for travel on the expected date of " +
          "arrival indicated below. You may choose to download or print a copy of this and retain it for the duration of " +
          "your stay. Please note that the Thailand Digital Arrival Card is not a visa. The use of the Thailand Digital " +
          "Arrival Card e-Service is free of charge."
      );
    doc.moveDown(0.5);

    doc
      .fontSize(10)
      .text(
        "Kindly ensure that the information provided is accurate and aligns with your travel documents " +
          "to avoid any issues upon your arrival in Thailand."
      );
    doc.moveDown(0.5);

    doc
      .fontSize(10)
      .text(
        "You can update your Thailand Digital Arrival Card information through the official " +
          "website at https://tdac.immigration.go.th/arrival-card or by scanning the QR code " +
          "provided below, before entering Thailand. For more information on Thailand's entry " +
          "requirements, please visit the official website."
      );
    doc.moveDown(1.5);

    const qrUpdate = await QRCode.toBuffer(updateUrl, { width: 100 });

    const startY = doc.y;

    doc.image(qrUpdate, doc.page.margins.left, startY, { fit: [100, 100] });

    doc
      .fontSize(10)
      .text(
        "To update your information or for further assistance, please scan the QR code",
        doc.page.margins.left + 120,
        startY + 50,
        {
          width:
            doc.page.width - doc.page.margins.left - doc.page.margins.right,
          align: "left",
        }
      );

    doc.y = startY + 120;

    // Transaction Date
    doc.x = doc.page.margins.left;
    const transactionDate = formatDate(new Date().toISOString());
    doc.fontSize(10).text(`Transaction Date: ${transactionDate}`);
    doc.moveDown(1.5);

    const rectY = doc.y;
    const rectHeight = 20;
    const rectWidth =
      doc.page.width - doc.page.margins.left - doc.page.margins.right;

    doc.rect(doc.page.margins.left, rectY, rectWidth, rectHeight).stroke();

    const fullName =
      `${personalData.first_name} ${personalData.family_name}`.trim().toUpperCase();
    doc
      .fontSize(10)
      .text(fullName, doc.page.margins.left + 10, rectY + rectHeight / 3, {
        width: rectWidth / 2,
        align: "left",
      });

    doc
      .fontSize(10)
      .text(
        `Date of Arrival                         ${formatDate(
          tripData.date_of_arrival
        )}  `,
        doc.page.margins.left + rectWidth / 2,
        rectY + rectHeight / 3,
        {
          width: rectWidth / 2 - 84,
          align: "right",
        }
      );

    const rect2Y = rectY + rectHeight;
    const rect2Height = 140;

    doc.rect(doc.page.margins.left, rect2Y, rectWidth, rect2Height).stroke();

    const qrBuffer = await QRCode.toBuffer(publicUrl, { width: 120 });
    doc.image(qrBuffer, doc.page.margins.left + 5, rect2Y + 5, {
      fit: [120, 120],
    });

    const qrWidth = 130;
    const remainingWidth = rectWidth - qrWidth;

    doc
      .fontSize(10)
      .text(
        "TH Digital Arrival Card No.",
        doc.page.margins.left + qrWidth,
        rect2Y + 10,
        {
          width: remainingWidth / 3 - 10,
          align: "center",
        }
      );

    // Passport No.
    doc
      .fontSize(10)
      .text(
        "Passport No.",
        doc.page.margins.left + qrWidth + remainingWidth / 3,
        rect2Y + 10,
        {
          width: remainingWidth / 3 - 10,
          align: "center",
        }
      );

    // Flight No./Vehicle No.
    doc
      .fontSize(10)
      .text(
        "Flight No./Vehicle No.",
        doc.page.margins.left + qrWidth + (remainingWidth * 2) / 3,
        rect2Y + 10,
        {
          width: remainingWidth / 3 - 10,
          align: "center",
        }
      );

    doc
      .fontSize(10)
      .text(uniqueId.toUpperCase(), doc.page.margins.left + qrWidth, rect2Y + 35, {
        width: remainingWidth / 3 - 10,
        align: "center",
      });

    doc
      .fontSize(10)
      .text(
        personalData.passport_no.toUpperCase(),
        doc.page.margins.left + qrWidth + remainingWidth / 3,
        rect2Y + 35,
        {
          width: remainingWidth / 3 - 10,
          align: "center",
        }
      );

    doc
      .fontSize(10)
      .text(
        tripData.flight_vehicle_no_arrival.toUpperCase(),
        doc.page.margins.left + qrWidth + (remainingWidth * 2) / 3,
        rect2Y + 35,
        {
          width: remainingWidth / 3 - 10,
          align: "center",
        }
      );

    doc.y = rect2Y + rect2Height + 10;

    doc.addPage();

    //Next Page
    doc.fontSize(10).text("TH Digital Arrival Card No.   ");
    doc.moveDown(1.5);
    doc.fontSize(10).text("Personal Information");
    const lineY = doc.y;
    doc
      .moveTo(doc.page.margins.left, lineY)
      .lineTo(doc.page.width - doc.page.margins.right, lineY)
      .stroke();
    doc.moveDown(2);

    doc.fontSize(10);
    const labelWidth = 200;
    const valueX = doc.page.width / 2 + 10;

    const drawField = (label, value) => {
      const y = doc.y;
      doc.text(label, doc.page.width / 2 - labelWidth, y, {
        width: labelWidth,
        align: "right",
        continued: false,
      });
      doc.text(value, valueX, y, {
        width: doc.page.width - valueX - 50,
        align: "left",
        continued: false,
      });
      doc.moveDown(0.3);
    };

    drawField(
      "Full Name ",
      `${personalData.first_name} ${personalData.middle_name || ""} ${
        personalData.family_name
      }`
        .trim()
        .toUpperCase()
    );
    doc.moveDown(0.3);
    drawField("Gender :", personalData.gender.toUpperCase());
    doc.moveDown(0.3);
    drawField(
      "Nationality/Citizenship :",
      personalData.selected_nationality.toUpperCase()
    );
    doc.moveDown(0.3);
    drawField("Passport No. :", personalData.passport_no.toUpperCase());
    doc.moveDown(0.3);
    drawField("Date of Birth :", formatDate(personalData.date_of_birth));
    doc.moveDown(0.3);
    drawField("Occupation :", personalData.occupation.toUpperCase());
    doc.moveDown(0.3);
    drawField(
      "Country/Territory of Residence :",
      personalData.selected_country.toUpperCase()
    );
    doc.moveDown(0.3);
    drawField(
      "City/State of Residence :",
      personalData.selected_city.toUpperCase()
    );
    doc.moveDown(0.3);
    drawField("Visa No. :", (personalData.visa_no.toUpperCase() || "-"));
    doc.moveDown(0.3);
    drawField(
      "Phone No. :",
      `+${personalData.phone_no_code} ${personalData.phone_no}`
    );
    doc.moveDown(1);

    // Trip Information Section
    doc.x = doc.page.margins.left;
    doc.fontSize(10).text("Trip Information");
    const line = doc.y;
    doc
      .moveTo(doc.page.margins.left, line)
      .lineTo(doc.page.width - doc.page.margins.right, line)
      .stroke();
    doc.moveDown(2);

    // Arrival Information
    doc.x = doc.page.margins.left;
    doc.fontSize(10).text("Arrival Information");
    doc.moveDown(0.3);
    doc.fontSize(10);
    drawField("Date of Arrival :", formatDate(tripData.date_of_arrival));
    doc.moveDown(0.3);
    drawField("Country Boarded :", tripData.country_boarded.toUpperCase());
    doc.moveDown(0.3);
    drawField("Purpose of Travel :", tripData.purpose_of_travel.toUpperCase());
    doc.moveDown(0.3);
    drawField(
      "Mode of Travel :",
      tripData.mode_of_travel_arrival.toUpperCase()
    );
    doc.moveDown(0.3);
    drawField(
      "Mode of Transport :",
      tripData.mode_of_transport_arrival.toUpperCase()
    );
    doc.moveDown(0.3);
    drawField(
      "Flight No./Vehicle No. :",
      tripData.flight_vehicle_no_arrival.toUpperCase()
    );
    doc.moveDown(0.8);

    // Departure Information
    doc.x = doc.page.margins.left;
    doc.fontSize(10).text("Departure Information");
    doc.moveDown(0.3);
    doc.fontSize(10);
    drawField(
      "Date of Departure :",
      formatDate(tripData.date_of_departure) || "-"
    );
    doc.moveDown(0.3);
    drawField(
      "Mode of Travel :",
      (tripData.mode_of_travel_departure.toUpperCase() || "-")
    );
    doc.moveDown(0.3);
    drawField(
      "Mode of Transport :",
      (tripData.mode_of_transport_departure.toUpperCase() || "-")
    );
    doc.moveDown(0.3);
    drawField(
      "Flight No./Vehicle No. :",
      (tripData.flight_vehicle_no_departure.toUpperCase() || "-")
    );
    doc.moveDown(0.8);

    doc.x = doc.page.margins.left;
    doc.fontSize(10).text("Accommodation Information");
    const line1 = doc.y;
    doc
      .moveTo(doc.page.margins.left, line1)
      .lineTo(doc.page.width - doc.page.margins.right, line1)
      .stroke();
    doc.moveDown(2);
    doc.moveDown(0.3);
    doc.fontSize(10);
    drawField(
      "Type of Accommodation :",
      tripData.type_of_accommodation.toUpperCase()
    );
    doc.moveDown(0.3);
    drawField("Post Code :", tripData.post_code);
    doc.moveDown(0.3);
    drawField(
      "Address :",
      `${tripData.province}, ${tripData.district_area}, ${tripData.sub_district}, ${tripData.address}`
    );

    doc.end();

    // Wait for the WRITE STREAM to finish (not the doc)
    await new Promise((resolve, reject) => {
      writeStream.on("finish", resolve);
      writeStream.on("error", reject);
    });

    const pdfBuffer = fs.readFileSync(filePath);

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("pdfs")
      .upload(`${uniqueId}.pdf`, pdfBuffer, {
        contentType: "application/pdf",
        upsert: false,
      });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      throw uploadError;
    }

    console.log("PDF uploaded successfully:", publicUrl);

    fs.unlinkSync(filePath);

    const finalData = {
      profile_id: profileData[0].id,
      tr_id: trData[0].id,
      filepath: publicUrl,
      qrcode_data: uniqueId,
    };
    const { data: formData, error: formError } = await supabase
      .from("entry_form")
      .insert([finalData])
      .select();

    if (formError) throw formError;

    res.json({
      success: true,
      profile: profileData,
      travel: trData,
      entry: formData,
      publicUrl,
    });
  } catch (error) {
    console.error("Error inserting data:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

app.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`)
);
