export class EtimsService {
  static async submitInvoice(orgId: string, invoiceId: string, invoiceData: any) {
    // Mock network delay
    await new Promise(resolve => setTimeout(resolve, 800));
    
    // Mock response from eTIMS
    const isSuccess = Math.random() > 0.1; // 90% success rate
    
    if (!isSuccess) {
      throw new Error('KRA eTIMS Error: 503 Service Unavailable');
    }

    const controlCode = 'KRA-' + Math.random().toString(36).substring(2, 10).toUpperCase();
    const qrCodeUrl = `https://etims.kra.go.ke/verify?c=${controlCode}`;

    return {
      success: true,
      controlCode,
      qrCodeUrl,
      submittedAt: new Date().toISOString()
    };
  }
}
