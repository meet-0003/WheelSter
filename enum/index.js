const DriverStatus = Object.freeze({
    PENDING: 'pending',
    ACCEPTED: 'accepted',
    REJECTED: 'rejected'
});
const PaymentStatus = Object.freeze({
    PENDING: 'Pending',
    PAID: 'Paid',
    FAILED: 'Failed',
    REFUNDED: 'Refunded'
});
const BookingStatus = Object.freeze({
    PENDING: 'Pending',
    ACCEPTED: 'Accepted',
    CONFIRMED: 'Confirmed',
    COMPLETED: 'Completed',
    CANCELLED: 'Cancelled'
});

module.exports = { DriverStatus, BookingStatus, PaymentStatus }