// © 2026 Artivicolab. All rights reserved. ProxForm — proprietary software. See LICENSE.
// ProxForm — starter templates surfaced on forms.html. Each template is a
// ready-to-use form object (matches the parseIndented output schema).

(function () {
  const T = [
    {
      id: 'medical-intake',
      name: 'Pre-appointment intake',
      industry: 'Medical & Clinical',
      summary: 'Patient information, reason for visit, medical history, and consent.',
      form: {
        title: 'Pre-appointment intake',
        description: 'Please fill this in before your visit.',
        fields: [
          { id: 'f1',  type: 'section',  label: 'Patient Information' },
          { id: 'f2',  type: 'text',     label: 'Full name',         required: true,  column: 'half' },
          { id: 'f3',  type: 'date',     label: 'Date of birth',     required: true,  column: 'half' },
          { id: 'f4',  type: 'text',     label: 'Phone',             required: false, column: 'half' },
          { id: 'f5',  type: 'text',     label: 'Email',             required: false, column: 'half' },
          { id: 'f6',  type: 'text',     label: 'Address',           required: false, column: 'full' },
          { id: 'f7',  type: 'section',  label: 'Reason for Visit' },
          { id: 'f8',  type: 'textarea', label: 'Primary reason for visit', required: true, column: 'full' },
          { id: 'f9',  type: 'yesno',    label: 'Have you been treated for this before?', required: false, column: 'full' },
          { id: 'f10', type: 'radio',    label: 'How would you describe the pain?', required: true, column: 'full',
            options: ['None', 'Mild', 'Moderate', 'Severe'] },
          { id: 'f11', type: 'section',  label: 'Medical History' },
          { id: 'f12', type: 'checkbox', label: 'Existing conditions (tick all that apply)', required: false, column: 'full',
            options: ['Diabetes', 'Hypertension', 'Heart disease', 'Asthma', 'None of the above'] },
          { id: 'f13', type: 'textarea', label: 'Current medications',     required: false, column: 'full' },
          { id: 'f14', type: 'text',     label: 'Allergies (write "none" if applicable)', required: false, column: 'full' },
          { id: 'f15', type: 'section',  label: 'Consent' },
          { id: 'f16', type: 'yesno',    label: 'I consent to my data being processed for this appointment.', required: true, column: 'full' }
        ]
      }
    },
    {
      id: 'legal-intake',
      name: 'New client intake',
      industry: 'Legal, Notary & Government',
      summary: 'Contact details, matter description, and conflict check for law-firm intake.',
      form: {
        title: 'New client intake',
        description: 'Bring photo ID to your first meeting.',
        fields: [
          { id: 'f1',  type: 'section',  label: 'Contact' },
          { id: 'f2',  type: 'text',     label: 'Full legal name', required: true,  column: 'half' },
          { id: 'f3',  type: 'text',     label: 'Preferred name',  required: false, column: 'half' },
          { id: 'f4',  type: 'text',     label: 'Phone',           required: true,  column: 'half' },
          { id: 'f5',  type: 'text',     label: 'Email',           required: true,  column: 'half' },
          { id: 'f6',  type: 'text',     label: 'Mailing address', required: false, column: 'full' },
          { id: 'f7',  type: 'section',  label: 'Matter' },
          { id: 'f8',  type: 'radio',    label: 'Practice area',   required: true,  column: 'full',
            options: ['Family', 'Criminal', 'Civil', 'Estate', 'Immigration', 'Other'] },
          { id: 'f9',  type: 'textarea', label: 'Brief description of the matter', required: true, column: 'full' },
          { id: 'f10', type: 'date',     label: 'Date of incident or trigger event', required: false, column: 'half' },
          { id: 'f11', type: 'yesno',    label: 'Have you retained other counsel on this matter?', required: true, column: 'half' },
          { id: 'f12', type: 'section',  label: 'Conflict check' },
          { id: 'f13', type: 'text',     label: 'Opposing party (if known)', required: false, column: 'full' },
          { id: 'f14', type: 'text',     label: 'Other parties involved',    required: false, column: 'full' }
        ]
      }
    },
    {
      id: 'hotel-checkin',
      name: 'Guest check-in',
      industry: 'Hospitality & Luxury Retail',
      summary: 'Boutique hotel check-in: identity, stay dates, preferences, and dietary needs.',
      form: {
        title: 'Guest check-in',
        description: 'Quick check-in — please fill in before arriving at the desk.',
        fields: [
          { id: 'f1', type: 'section',  label: 'Guest' },
          { id: 'f2', type: 'text',     label: 'Full name',         required: true, column: 'half' },
          { id: 'f3', type: 'text',     label: 'Confirmation number', required: true, column: 'half' },
          { id: 'f4', type: 'date',     label: 'Check-in date',     required: true, column: 'half' },
          { id: 'f5', type: 'date',     label: 'Check-out date',    required: true, column: 'half' },
          { id: 'f6', type: 'text',     label: 'Nationality',       required: true, column: 'full' },
          { id: 'f7', type: 'section',  label: 'Stay preferences' },
          { id: 'f8', type: 'radio',    label: 'Bed preference',    required: false, column: 'full',
            options: ['King', 'Twin', 'Queen', 'No preference'] },
          { id: 'f9', type: 'checkbox', label: 'Dietary requirements', required: false, column: 'full',
            options: ['Vegetarian', 'Vegan', 'Gluten-free', 'Nut allergy', 'Lactose-free'] },
          { id: 'f10', type: 'textarea', label: 'Special requests or accessibility needs', required: false, column: 'full' }
        ]
      }
    },
    {
      id: 'hr-nda',
      name: 'Interview NDA & consent',
      industry: 'HR & Secure Corporate',
      summary: 'Visitor identity, NDA acknowledgement, and background-check consent.',
      form: {
        title: 'Interview NDA & consent',
        description: 'Sign in before your interview.',
        fields: [
          { id: 'f1', type: 'section', label: 'Visitor' },
          { id: 'f2', type: 'text',    label: 'Full name',         required: true, column: 'half' },
          { id: 'f3', type: 'text',    label: 'Company (if any)',  required: false, column: 'half' },
          { id: 'f4', type: 'date',    label: 'Visit date',        required: true, column: 'half' },
          { id: 'f5', type: 'text',    label: 'Host name',         required: true, column: 'half' },
          { id: 'f6', type: 'section', label: 'Agreements' },
          { id: 'f7', type: 'yesno',   label: 'I have read and agree to the visitor non-disclosure terms.', required: true, column: 'full' },
          { id: 'f8', type: 'yesno',   label: 'I consent to a background check for this role.', required: true, column: 'full' },
          { id: 'f9', type: 'yesno',   label: 'I consent to being filmed for security purposes.', required: false, column: 'full' },
          { id: 'f10', type: 'section', label: 'Optional' },
          { id: 'f11', type: 'textarea', label: 'Comments for the recruiter', required: false, column: 'full' }
        ]
      }
    },
    {
      id: 'tattoo-waiver',
      name: 'Tattoo consent & medical history',
      industry: 'Wellness, Fitness & Personal Care',
      summary: 'Studio liability waiver: ID, medical history, allergies, and consent.',
      form: {
        title: 'Tattoo consent & medical history',
        description: 'Required before any session. Please answer honestly.',
        fields: [
          { id: 'f1', type: 'section', label: 'Identification' },
          { id: 'f2', type: 'text',    label: 'Full name',           required: true, column: 'half' },
          { id: 'f3', type: 'date',    label: 'Date of birth',       required: true, column: 'half' },
          { id: 'f4', type: 'text',    label: 'Government ID number', required: true, column: 'full' },
          { id: 'f5', type: 'section', label: 'Medical history' },
          { id: 'f6', type: 'yesno',   label: 'Are you currently taking blood-thinning medication?', required: true, column: 'full' },
          { id: 'f7', type: 'yesno',   label: 'Do you have a heart condition?', required: true, column: 'full' },
          { id: 'f8', type: 'yesno',   label: 'Are you pregnant or breastfeeding?', required: true, column: 'full' },
          { id: 'f9', type: 'yesno',   label: 'Do you have diabetes?', required: true, column: 'full' },
          { id: 'f10', type: 'checkbox', label: 'Allergies (tick all that apply)', required: false, column: 'full',
            options: ['Latex', 'Lidocaine', 'Nickel', 'Antibiotics', 'None'] },
          { id: 'f11', type: 'section', label: 'Consent' },
          { id: 'f12', type: 'yesno',   label: 'I understand the procedure and risks.', required: true, column: 'full' },
          { id: 'f13', type: 'yesno',   label: 'I confirm I am over 18.', required: true, column: 'full' }
        ]
      }
    }
  ];

  window.ProxTemplates = {
    list: () => T.slice(),
    get: (id) => T.find(t => t.id === id) || null
  };
})();
