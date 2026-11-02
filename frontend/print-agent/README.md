# LRMIS print program

Certificates and ID cards print only through this program. Run one copy for each added printer, on the computer the printer is connected to.

## Set up

1. Install Node.js on the computer, and make sure the printer is installed and can print.
2. On the website, open **Add printer**, add the printer and press the key button. Copy the key: it is shown only once.
3. Copy this folder to the computer, and copy `config.example.json` to `config.json`. Put in the site address and the key.
4. In this folder run:

```bash
npm install
```

```bash
npm start
```

The printer's **Print program** column on the Add printer page changes to **Online**. Set the program to start with the computer so it is always running.

"Name on the computer" on the Add printer page must match the printer's name in the computer's printer list exactly.

## How it stays locked

- The key belongs to one printer. Only its hash is kept on the server. Replacing the key stops the old one at once.
- The program prints only on the printer named for that key, and the document page opens only with a one-time code for that job.
- It stops and raises an alert on the Add printer page if the printer is switched off there, is missing from the computer, or a different device (MAC address) answers at its IP address.
- "Printed" means the computer accepted the job for the printer. A paper jam after that is not seen, so check the sheet.
