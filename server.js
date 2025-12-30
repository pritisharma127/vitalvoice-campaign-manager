import express from 'express';
import bodyParser from 'body-parser';
import twilio from 'twilio';
import 'dotenv/config';
import WebSocket from 'ws';

const app = express();

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

const {
    PORT = 3001,
    TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN,
    TWILIO_WHATSAPP_NUMBER,
    ELEVENLABS_API_KEY,
    ELEVENLABS_AGENT_ID,
    GOOGLE_MAPS_API_KEY
} = process.env;


if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_WHATSAPP_NUMBER) {
    console.error('Missing Twilio config in .env');
    process.exit(1);
}
if (!ELEVENLABS_API_KEY || !ELEVENLABS_AGENT_ID) {
    console.error('Missing ElevenLabs config in .env');
    process.exit(1);
}

const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

app.post('/process-info', async (req, res) => {
    try {

        const { data } = req.body;
        const donorAvailability = data.analysis?.data_collection_results?.donor_availability?.value;
        const altPhoneNumber = data.analysis?.data_collection_results?.alt_phone_number?.value;
        const currentLocation = data.analysis?.data_collection_results?.current_location?.value;
        const donorEligibility = data.analysis?.data_collection_results?.donor_eligibility?.value;
        const hospitalLocation = data.analysis?.data_collection_results?.hospital_location?.value;
        const donorName = data.analysis?.data_collection_results?.donor_name?.value;
        const bloodRequirementDatetime = data.analysis?.data_collection_results?.blood_requirement_datetime?.value;
        const calledNumber = data.conversation_initiation_client_data?.dynamic_variables?.system__agent_id;
        const googleMapsLink = data.analysis?.data_collection_results?.google_maps_link?.value;

        console.log(`donorAvailability: ${donorAvailability}, altPhoneNumber: ${altPhoneNumber}, currentLocation: ${currentLocation}, donorEligibility: ${donorEligibility}, hospitalLocation: ${hospitalLocation}, donorName: ${donorName}, bloodRequirementDatetime: ${bloodRequirementDatetime}`);

        const conversation_id = data.conversation_id;
        const url = `https://rgrsvvbnvadtdpmwmiyq.supabase.co/functions/v1/call-transactions?call_id=${conversation_id}`;

        const payload = {
            availability: donorAvailability,
            alternate_phone: altPhoneNumber,
            current_location: currentLocation,
            pincode: "NA",
            eligibility: donorEligibility,
            donor_selected: donorAvailability === "YES" && donorEligibility === "ELIGIBLE" ? "YES" : "NO",
            whatsapp_sent: "YES",
            sms_sent: "NO",
            email_sent: "NO"
        };

        fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
            .then(res => res.json())
            .then(data => console.log(data))
            .catch(err => console.error('Error:', err));

        const to = `whatsapp:${calledNumber}`;

        const text_long = `━━━━━━━━━━━━━━━━━━━━
*BLOOD DONATION DETAILS*
━━━━━━━━━━━━━━━━━━━━

Hello ${donorName || ''}, 

Thank you for your incredible willingness to donate blood. Your contribution truly saves lives.

*APPOINTMENT INFO*
────────────────────
↳ Date/Time: ${bloodRequirementDatetime || 'Info Not Available'}
↳ Location: ${hospitalLocation || 'Info Not Available'}
↳ Directions: ${googleMapsLink || 'Info Not Available'}

*IMPORTANT PREPARATION*
Please ensure you are well-hydrated and have eaten a nutritious meal before your arrival.

Thank you for making a difference.
────────────────────`;
        
        if (payload?.donor_selected === "YES") {
            const result = await twilioClient.messages.create({
                from: TWILIO_WHATSAPP_NUMBER,
                to,
                body: text_long,
            });
        }

        res.status(200).send('Webhook received');

    } catch (err) {
        console.error("Error sending WhatsApp message", err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/get-distance', async (req, res) => {
    const { start, destination } = req.body;

    if (!start || !destination) {
        return res.status(400).json({ error: 'Please provide start and destination locations.' });
    }

    try {
        const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(start)}&destinations=${encodeURIComponent(destination)}&key=${GOOGLE_MAPS_API_KEY}`;

        const response = await fetch(url);
        const data = await response.json();

        if (data.status !== 'OK' || data.rows[0].elements[0].status !== 'OK') {
            return res.status(400).json({ error: 'Could not calculate distance. Check your locations.' });
        }

        // Extracting data from Google's response
        const element = data.rows[0].elements[0];

        // Construct the clickable Google Maps Link
        const mapsLink = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(start)}&destination=${encodeURIComponent(destination)}&travelmode=driving`;

        const result = {
            distance_km: element.distance.text, // e.g., "15.5 km"
            time_required: element.duration.text, // e.g., "25 mins"
            google_maps_link: mapsLink
        };
        console.log("Distance Matrix Result:", result);
        res.json(result);
        
    } catch (error) {
        res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
});

// For independent testing - START
app.post('/send/whatsapp', async (req, res) => {
    try {
        let to = req.body.to;
        to = `whatsapp:${to}`;
        const text = req.body.text || "Hello! This is a static WhatsApp message.";

        if (!to) {
            return res.status(400).json({ error: "Missing 'to' phone number." });
        }

        const text_long = `━━━━━━━━━━━━━━━━━━━━
*BLOOD DONATION DETAILS*
━━━━━━━━━━━━━━━━━━━━

Hello John,

Thank you for your incredible willingness to donate blood. Your contribution truly saves lives.

*APPOINTMENT INFO*
────────────────────
↳ Date/Time: Within 3 Hours
↳ Location: Hosmat Hospital, Bangalore - 560043
↳ Directions: https://www.google.com/maps/dir/?api=1&origin=Ikea%2C%20Bangalore&destination=Hosmat%20hospital%2C%20Kalyan%20nagar%2C%20Bangalore&travelmode=driving

*IMPORTANT PREPARATION*
Please ensure you are well-hydrated and have eaten a nutritious meal before your arrival.

Thank you for making a difference.
────────────────────`;

        const result = await twilioClient.messages.create({
            from: "whatsapp:+1415523xxxx", // e.g. "whatsapp:+1415xxxxxxx"
            to: "whatsapp:+91983414xxxx",
            body: text_long,
        });

        res.json({
            success: true,
            sid: result.sid,
            message: `WhatsApp message sent to ${to}`,
        });
    } catch (err) {
        console.error("Error sending WhatsApp message", err);
        res.status(500).json({ error: err.message });
    }
});
// For independent testing - END


app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
