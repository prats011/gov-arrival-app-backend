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

    const doc = new PDFDocument({ margin: 50 });
    const filePath = `./pdfs/${uniqueId}.pdf`;
    fs.mkdirSync("./pdfs", { recursive: true });
    doc.pipe(fs.createWriteStream(filePath));

    
    doc.fontSize(20).text("Thailand Arrival Declaration", { align: "center" });
    doc.moveDown();

    doc.fontSize(14).text("Personal Information", { underline: true });
    Object.entries(validationPI.data).forEach(([key, value]) => {
      doc.fontSize(12).text(`${key.replaceAll("_", " ")}: ${value}`);
    });
    doc.moveDown();

    doc
      .fontSize(14)
      .text("Trip & Accommodation Information", { underline: true });
    Object.entries(validationTR.data).forEach(([key, value]) => {
      doc.fontSize(12).text(`${key.replaceAll("_", " ")}: ${value}`);
    });
    doc.moveDown();

    doc.fontSize(14).text("Health Declaration", { underline: true });
    doc
      .fontSize(12)
      .text(`Countries Visited: ${health.countries_visited.join(", ")}`);
    doc.moveDown();

    doc.fontSize(14).text("Scan this QR code: ");
    const qrData = `https://your-server.com/files/${pdfFileName}.pdf`;
    doc.image(qrData, { fit: [150, 150], align: "center" });

    doc.end();

    //4. insert in final entry form and create qr code etc.
    const finalData = {
      profile_id: profileData[0].id,
      tr_id: trData[0].id,
      filepath: filePath,
      qrcode_data: uniqueId,
    };
    const { data: formData, error: formError } = await supabase
      .from("entry_form")
      .insert([finalData])
      .select();

    if (formError) throw formError;

    //5. return success or error, all in one try catch
    res.json({
      success: true,
      profile: profileData,
      travel: trData,
      entry: formData,
    });
  } catch (error) {
    console.error("Error inserting data:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

app.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`)
);
