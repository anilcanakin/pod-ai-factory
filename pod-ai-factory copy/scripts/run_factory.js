const fetch = require('node-fetch');

async function main() {
    try {
        console.log("Triggering /api/factory/run...");
        const res = await fetch("http://localhost:3000/api/factory/run", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                referenceImageId: "assets/references/USA255.jpg",
                engines: ["fal.ai"],
                variationCount: 3,
                generateCount: 3,
                autoApprove: false
            })
        });

        const data = await res.json();
        console.log(JSON.stringify(data, null, 2));

        if (data.jobId) {
            console.log(`\nTo debug this job, run: node scripts/debug_job.js ${data.jobId}`);

            console.log(`\nFetching Gallery for Job ID: ${data.jobId}`);
            const galRes = await fetch(`http://localhost:3000/api/gallery/${data.jobId}`);
            const galData = await galRes.json();
            console.log(JSON.stringify(galData, null, 2));
        }

    } catch (e) {
        console.error(e);
    }
}
main();
